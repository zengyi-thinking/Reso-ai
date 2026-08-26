from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Protocol

import httpx

from reso_agent.contracts import AgentMode, ModelMetadata, RecentMessage


class ModelProviderError(RuntimeError):
    """A configured real provider failed. Callers must not silently fall back."""


@dataclass(frozen=True)
class ModelRequest:
    mode: AgentMode
    system_prompt: str
    user_message: str
    recent_messages: tuple[RecentMessage, ...]
    memory_summaries: tuple[str, ...]
    is_correction: bool
    no_analysis: bool


@dataclass(frozen=True)
class ModelResponse:
    content: str
    metadata: ModelMetadata


class ModelProvider(Protocol):
    async def generate(self, request: ModelRequest) -> ModelResponse: ...


def _first_env(*names: str) -> str:
    return next((os.environ[name] for name in names if os.environ.get(name)), "")


def _load_local_env_for_development() -> None:
    if os.getenv("APP_ENV", "development").lower() == "production":
        return
    if _first_env("LLM_API_KEY", "MINIMAX_API_KEY", "MiniMax_AUTH_TOKEN"):
        return
    path = Path(__file__).parents[4] / ".env"
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip().rstrip(",")
        if not line or line.startswith("#"):
            continue
        separator = "=" if "=" in line else ":" if ":" in line else None
        if separator is None:
            continue
        raw_key, raw_value = line.split(separator, 1)
        key = raw_key.strip().strip("\"'")
        value_text = raw_value.strip()
        try:
            value = json.loads(value_text)
        except json.JSONDecodeError:
            value = value_text.strip("\"'")
        if isinstance(value, str):
            os.environ.setdefault(key, value)


class DeterministicModelProvider:
    name = "deterministic"
    model = "reso-relational-v1"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        if request.is_correction:
            content = "好，这个区别很重要。我会以你的纠正为准，不再把它简单归成‘慢热’。"
        elif request.no_analysis:
            content = "好，那就不分析。我们先只待在你现在的感受里。"
        elif request.mode is AgentMode.PREPROCESSOR:
            content = (
                "先别急着找最漂亮的话。可以从你的真实意图开始："
                "“我想认真说清楚，但也不想把压力推给你……” 你想更直接一点，还是更柔和一点？"
            )
        elif request.mode is AgentMode.MIRROR:
            content = (
                "我有一个不太确定的猜测：你在意的可能不是社交多少，而是这段互动有没有真实内容。"
                "这个描述像你吗？"
            )
        elif any(marker in request.user_message for marker in ("累", "疲惫", "没劲")):
            content = "那今天先少折腾一点。能推到明天的，就别都扛在今晚。"
        elif request.memory_summaries:
            content = (
                f"这让我想到你之前提过的“{request.memory_summaries[0]}”。这次也是同一种感觉吗？"
            )
        else:
            content = "我在。你想从哪一小段开始说？"
        return ModelResponse(
            content=content,
            metadata=ModelMetadata(
                provider=self.name,
                model=self.model,
                latency_ms=0,
                prompt_tokens=None,
                completion_tokens=None,
            ),
        )


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    api_key: str
    base_url: str
    timeout_seconds: float = 45.0

    @classmethod
    def from_env(cls) -> ProviderConfig:
        _load_local_env_for_development()
        provider = os.getenv("LLM_PROVIDER", "").strip().lower()
        api_key = _first_env(
            "LLM_API_KEY", "MINIMAX_API_KEY", "MINIMAX_AUTH_TOKEN", "MiniMax_AUTH_TOKEN"
        ).strip()
        model = _first_env(
            "LLM_MODEL",
            "MINIMAX_MODEL",
            "MINIMAX_DEFAULT_HAIKU_MODEL",
            "MiniMax_DEFAULT_HAIKU_MODEL",
        ).strip()
        base_url = (
            _first_env("LLM_BASE_URL", "MINIMAX_BASE_URL", "MiniMax_BASE_URL")
            or "https://api.minimax.io/v1"
        ).strip()
        if not provider and api_key:
            provider = "minimax"
        if provider not in {"minimax", "real"}:
            raise ModelProviderError("LLM_PROVIDER must be 'minimax' for a real model call")
        missing = [name for name, value in (("model", model), ("api key", api_key)) if not value]
        if missing:
            raise ModelProviderError(f"MiniMax configuration is missing: {', '.join(missing)}")
        return cls(provider="minimax", model=model, api_key=api_key, base_url=base_url.rstrip("/"))


class MiniMaxModelProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self._config = config

    async def generate(self, request: ModelRequest) -> ModelResponse:
        started = monotonic()
        try:
            if "/anthropic" in self._config.base_url:
                content, prompt_tokens, completion_tokens = await self._anthropic(request)
            else:
                content, prompt_tokens, completion_tokens = await self._openai(request)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise ModelProviderError(f"MiniMax request failed: {type(error).__name__}") from error
        if not content.strip():
            raise ModelProviderError("MiniMax returned an empty text response")
        return ModelResponse(
            content=content.strip(),
            metadata=ModelMetadata(
                provider="minimax",
                model=self._config.model,
                latency_ms=round((monotonic() - started) * 1000),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            ),
        )

    def _messages(self, request: ModelRequest) -> list[dict[str, str]]:
        messages = [
            {"role": item.role, "content": item.content} for item in request.recent_messages
        ]
        messages.append({"role": "user", "content": request.user_message})
        return messages

    async def _openai(self, request: ModelRequest) -> tuple[str, int | None, int | None]:
        url = f"{self._config.base_url}/chat/completions"
        async with httpx.AsyncClient(timeout=self._config.timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {self._config.api_key}"},
                json={
                    "model": self._config.model,
                    "messages": [
                        {"role": "system", "content": request.system_prompt},
                        *self._messages(request),
                    ],
                    "temperature": 0.7,
                    "max_completion_tokens": 700,
                    "stream": False,
                    "reasoning_split": True,
                },
            )
            response.raise_for_status()
            payload = response.json()
        content = str(payload["choices"][0]["message"].get("content") or "")
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        usage = payload.get("usage") or {}
        return content, usage.get("prompt_tokens"), usage.get("completion_tokens")

    async def _anthropic(self, request: ModelRequest) -> tuple[str, int | None, int | None]:
        url = f"{self._config.base_url}/v1/messages"
        async with httpx.AsyncClient(timeout=self._config.timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"x-api-key": self._config.api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": self._config.model,
                    "system": request.system_prompt,
                    "messages": self._messages(request),
                    "temperature": 0.7,
                    "max_tokens": 700,
                },
            )
            response.raise_for_status()
            payload = response.json()
        blocks = payload.get("content") or []
        content = "\n".join(
            str(block.get("text", "")) for block in blocks if block.get("type") == "text"
        )
        usage = payload.get("usage") or {}
        return content, usage.get("input_tokens"), usage.get("output_tokens")


def create_real_provider_from_env() -> MiniMaxModelProvider:
    return MiniMaxModelProvider(ProviderConfig.from_env())
