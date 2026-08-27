from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Protocol

import httpx

from reso_agent.contracts import AgentMode, ModelMetadata, RecentMessage


class ModelProviderError(RuntimeError):
    """A configured real provider failed. Callers must not silently fall back."""


# Receives public text deltas as they stream in. Providers must never forward
# provider-side reasoning/thinking deltas through this callback.
OnTextDelta = Callable[[str], None]

# Fixed storage dimension; the `memories.embedding` pgvector column uses it too.
EMBEDDING_DIMENSION = 1536


def fit_embedding(raw: Sequence[float]) -> list[float]:
    """Project a raw provider vector onto the fixed storage dimension and
    re-normalize it so cosine similarity stays scale-free."""
    values = [float(value) for value in list(raw)[:EMBEDDING_DIMENSION]]
    values.extend(0.0 for _ in range(EMBEDDING_DIMENSION - len(values)))
    norm = math.sqrt(sum(value * value for value in values))
    if norm <= 0.0:
        return values
    return [round(value / norm, 6) for value in values]


def _lexical_terms(text: str) -> tuple[str, ...]:
    normalized = re.sub(r"\s+", "", text.lower())
    terms = sorted(set(re.findall(r"[a-z0-9]{2,}", normalized)))
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", normalized))
    terms.extend(sorted({cjk[index : index + 2] for index in range(max(0, len(cjk) - 1))}))
    return tuple(terms)


def _stable_unit_vector(term: str) -> tuple[float, ...]:
    seed = int.from_bytes(hashlib.sha256(term.encode("utf-8")).digest()[:8], "big")
    generator = random.Random(seed)
    gauss_values = [generator.gauss(0.0, 1.0) for _ in range(EMBEDDING_DIMENSION)]
    norm = math.sqrt(sum(value * value for value in gauss_values)) or 1.0
    return tuple(value / norm for value in gauss_values)


def deterministic_embedding(text: str) -> list[float]:
    """Bag-of-terms random projection: shared substrings score high cosine,
    disjoint texts stay near orthogonal. Deterministic across runs."""
    terms = _lexical_terms(text)
    if not terms:
        return [0.0] * EMBEDDING_DIMENSION
    accumulated = [0.0] * EMBEDDING_DIMENSION
    for term in terms:
        vector = _stable_unit_vector(term)
        for index, value in enumerate(vector):
            accumulated[index] += value
    return fit_embedding(accumulated)


@dataclass(frozen=True)
class ModelRequest:
    mode: AgentMode
    system_prompt: str
    user_message: str
    recent_messages: tuple[RecentMessage, ...]
    memory_summaries: tuple[str, ...]
    is_correction: bool
    no_analysis: bool
    # Two-pass re-consideration: "draft" asks for a tentative first take,
    # "reconsider" receives the draft and produces a revised final stance.
    generation_phase: str = "single"
    draft_text: str | None = None
    max_output_tokens: int = 700


_RELATIONSHIP_HINTS = ("她", "他", "朋友", "关系", "聊天", "回复", "冷淡", "疏远")

# Reflection cues used only by the deterministic route to keep tests hermetic.
_CORRECTION_MARKERS = ("不是", "其实", "别再", "我讨厌", "搞错", "不对")


def deterministic_reflection_plan(payload: dict) -> dict:
    """Canned batch-reflection output: one correction candidate per corrective
    user message plus an optional persona patch when a persona version exists.
    Weak transcripts intentionally produce no candidates at all."""
    transcript = payload.get("transcript") or []
    persona = payload.get("persona")
    focus = payload.get("focus") or "all"
    memory_candidates: list[dict] = []
    patch_candidates: list[dict] = []
    if focus != "patches":
        for row in transcript:
            role = row.get("role")
            content = str(row.get("content", ""))
            message_id = row.get("id")
            if role != "user" or not message_id:
                continue
            if not any(marker in content for marker in _CORRECTION_MARKERS):
                continue
            memory_candidates.append(
                {
                    "type": "correction",
                    "summary": "用户明确纠正了此前的解释，应以本次表达为准。",
                    "evidenceMessageIds": [message_id],
                    "confidence": 0.9,
                }
            )
            break
    if persona and memory_candidates and focus != "memories":
        evidence_id = memory_candidates[0]["evidenceMessageIds"][0]
        patch_candidates.append(
            {
                "path": "/confirmedPatterns/socialRhythm",
                "oldValue": None,
                "proposedValue": "对低价值社交主动性低",
                "reason": "用户在对话中明确纠正了旧标签。",
                "evidenceIds": [evidence_id],
                "confidence": 0.86,
            }
        )
    return {"memoryCandidates": memory_candidates, "personaPatchCandidates": patch_candidates}


@dataclass(frozen=True)
class ModelResponse:
    content: str
    metadata: ModelMetadata


class ModelProvider(Protocol):
    name: str

    async def generate(
        self, request: ModelRequest, on_text: OnTextDelta | None = None
    ) -> ModelResponse: ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Batch semantic embeddings for retrieval augmentation.

        An unconfigured embedding model must raise ModelProviderError instead of
        guessing vectors; callers decide whether to fall back to the lexical
        baseline (that fallback is a quality degradation, never fake output).
        """
        ...


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

    async def generate(
        self, request: ModelRequest, on_text: OnTextDelta | None = None
    ) -> ModelResponse:
        if request.generation_phase == "assist_analyze":
            content = json.dumps(
                {
                    "interpretation": "对方像是在发出一个轻量邀请，同时也给你保留选择空间。",
                    "replyRoutes": [
                        {
                            "id": "gentle-follow-up",
                            "label": "顺着聊下去",
                            "suggestedReply": "听起来不错，你有想去的地方吗？",
                        }
                    ],
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "assist_polish":
            payload = json.loads(request.user_message)
            content = json.dumps(
                {
                    "candidates": [
                        {
                            "id": "warm-clear",
                            "text": f"我想说得温和一点：{payload['draft']}",
                        }
                    ]
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "tea_party_act":
            payload = json.loads(request.user_message)
            turn_no = int(payload["turnNo"])
            content = json.dumps(
                {
                    "content": "我们可以先从一个轻松、不给彼此压力的话题开始。",
                    "shouldStop": turn_no >= 8,
                    "stopReason": "max_turns" if turn_no >= 8 else None,
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "tea_party_evaluate":
            content = json.dumps(
                {
                    "headline": "你们都更适合低压力、真实的交流",
                    "conversationStarter": "可以从最近让自己放松的一件小事聊起。",
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "personal_manual_generate":
            payload = json.loads(request.user_message)
            evidence = payload["evidence"]
            variable_definitions = [
                ("crisisInstinct", "危机中的行动起点"),
                ("involuntaryReaction", "压力下的自然反应"),
                ("incompatiblePattern", "需要谨慎相处的模式"),
                ("possibleMisreading", "可能出现的相互误读"),
                ("negativeFeeling", "冲突中容易出现的感受"),
                ("relationshipRedLine", "关系中的重要边界"),
                ("repairAction", "更容易接住的修复行动"),
                ("recoveryNeed", "恢复连接时的需要"),
                ("lifeVision", "当前显现的人生方向"),
            ]
            section_definitions = [
                ("deepNeed", "表层标签与深层关系需求"),
                ("defense", "极限压力下的防御本能"),
                ("incompatible", "冲突与需要避开的模式"),
                ("repair", "合适的冲突修复与支持蓝图"),
                ("vision", "人生愿景与关系方向"),
            ]
            content = json.dumps(
                {
                    "variables": [
                        {
                            "id": variable_id,
                            "name": name,
                            "description": (
                                f"{evidence[index % len(evidence)]['summary']}。"
                                "这是可修正的初步理解，不是固定结论。"
                            ),
                            "confidence": "medium",
                            "evidenceRefs": [evidence[index % len(evidence)]["evidenceRef"]],
                        }
                        for index, (variable_id, name) in enumerate(variable_definitions)
                    ],
                    "sections": [
                        {
                            "id": section_id,
                            "title": title,
                            "content": (
                                f"{evidence[index % len(evidence)]['summary']}。"
                                "后续真实经历可以继续补充或纠正。"
                            ),
                            "confidence": "medium",
                            "evidenceRefs": [evidence[index % len(evidence)]["evidenceRef"]],
                        }
                        for index, (section_id, title) in enumerate(section_definitions)
                    ],
                    "updateSummary": f"根据 {len(evidence)} 条 Journey Evidence 生成首版说明书。",
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "persona_quick_start":
            payload = json.loads(request.user_message)
            content = json.dumps(
                {
                    "identity": {"mbti": payload.get("mbti"), "zodiac": payload.get("zodiac")},
                    "values": ["真诚"],
                    "socialStyle": {"rhythm": payload["socialPreference"]},
                    "communicationStyle": {"preference": payload["communicationPreference"]},
                    "relationshipNeeds": [payload["relationshipGoal"]],
                    "boundaries": ["不在信息不足时替你下结论"],
                    "interests": [],
                    "currentGoals": [],
                    "confirmedPatterns": [],
                    "uncertainHypotheses": ["这只是基于 Quick Start 的初步理解，等待你的确认。"],
                },
                ensure_ascii=False,
            )
        elif request.generation_phase == "reflect":
            payload = json.loads(request.user_message)
            content = json.dumps(
                deterministic_reflection_plan(payload),
                ensure_ascii=False,
            )
        relationship = any(hint in request.user_message for hint in _RELATIONSHIP_HINTS)
        if request.generation_phase in {
            "assist_analyze",
            "assist_polish",
            "tea_party_act",
            "tea_party_evaluate",
            "personal_manual_generate",
            "persona_quick_start",
            "reflect",
        }:
            pass
        elif request.generation_phase == "draft":
            content = (
                "我第一反应是把这当成疏远的信号，但这个反应可能太快了，先别当真。"
                if relationship
                else "我有个初步的读法，但不太确定，先说给你听：这件事可能不止一种解释。"
            )
        elif request.generation_phase == "reconsider":
            content = (
                "重新想了一下：回复变少，和不愿意回应，其实是两回事。"
                "她还在回你，只是节奏变了。先别急着下定义——"
                "要不要先看看最近几次她主动开口时说了什么？"
                if relationship
                else "换了个角度再看：刚才那个解释只是其中一种可能。"
                "先把事实和我的猜测分开——你观察到的是现象，含义还没定。"
                "要不先说说你最在意的是哪一部分？"
            )
        elif request.is_correction:
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

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [deterministic_embedding(text) for text in texts]


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    api_key: str
    base_url: str
    timeout_seconds: float = 45.0
    # Optional: leaving this empty keeps every caller on the lexical baseline.
    # When set, memory-write and query paths hard-fail on embedding errors
    # instead of silently storing or comparing garbage vectors.
    embedding_model: str = ""

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
        embedding_model = _first_env("LLM_EMBEDDING_MODEL", "MINIMAX_EMBEDDING_MODEL").strip()
        return cls(
            provider="minimax",
            model=model,
            api_key=api_key,
            base_url=base_url.rstrip("/"),
            embedding_model=embedding_model,
        )


class MiniMaxModelProvider:
    name = "minimax"

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config

    @property
    def model(self) -> str:
        return self._config.model

    async def generate(
        self, request: ModelRequest, on_text: OnTextDelta | None = None
    ) -> ModelResponse:
        started = monotonic()
        try:
            if "/anthropic" in self._config.base_url:
                content, prompt_tokens, completion_tokens = await self._anthropic(request, on_text)
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
            {"role": self._provider_role(item.role), "content": item.content}
            for item in request.recent_messages
        ]
        messages.append({"role": "user", "content": request.user_message})
        return messages

    def _provider_role(self, role: str) -> str:
        if role == "user":
            return "user"
        if role == "agent":
            return "assistant"
        raise ModelProviderError(f"Unsupported conversation role: {role}")

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        if not self._config.embedding_model:
            raise ModelProviderError(
                "LLM_EMBEDDING_MODEL is not configured; semantic embeddings are unavailable"
            )
        try:
            async with httpx.AsyncClient(timeout=self._config.timeout_seconds) as client:
                response = await client.post(
                    f"{self._config.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self._config.api_key}"},
                    json={"model": self._config.embedding_model, "input": list(texts)},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise ModelProviderError(f"MiniMax embedding failed: {type(error).__name__}") from error
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or len(rows) != len(texts):
            raise ModelProviderError("MiniMax embedding response is malformed")
        ordered = sorted(rows, key=lambda row: int(row.get("index", 0)))
        try:
            return [fit_embedding(row["embedding"]) for row in ordered]
        except (KeyError, TypeError, ValueError) as error:
            raise ModelProviderError(
                f"MiniMax embedding response is malformed: {type(error).__name__}"
            ) from error

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
                    "max_completion_tokens": request.max_output_tokens,
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

    async def _anthropic(
        self, request: ModelRequest, on_text: OnTextDelta | None = None
    ) -> tuple[str, int | None, int | None]:
        url = f"{self._config.base_url}/v1/messages"
        if on_text is not None:
            return await self._anthropic_stream(url, request, on_text)
        async with httpx.AsyncClient(timeout=self._config.timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"x-api-key": self._config.api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": self._config.model,
                    "system": request.system_prompt,
                    "messages": self._messages(request),
                    "temperature": 0.7,
                    "max_tokens": request.max_output_tokens,
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

    async def _anthropic_stream(
        self, url: str, request: ModelRequest, on_text: OnTextDelta
    ) -> tuple[str, int | None, int | None]:
        """Stream the response so designed public thinking lines reach the
        runtime while the model is still writing.

        Only `text_delta` blocks are forwarded; provider reasoning deltas are
        discarded and never leave this process.
        """
        chunks: list[str] = []
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        async with (
            httpx.AsyncClient(timeout=self._config.timeout_seconds) as client,
            client.stream(
                "POST",
                url,
                headers={"x-api-key": self._config.api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": self._config.model,
                    "system": request.system_prompt,
                    "messages": self._messages(request),
                    "temperature": 0.7,
                    "max_tokens": request.max_output_tokens,
                    "stream": True,
                },
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                event_type = event.get("type")
                if event_type == "content_block_delta":
                    delta = event.get("delta") or {}
                    if delta.get("type") == "text_delta":
                        text = str(delta.get("text") or "")
                        if text:
                            chunks.append(text)
                            on_text(text)
                elif event_type == "message_start":
                    usage = (event.get("message") or {}).get("usage") or {}
                    prompt_tokens = usage.get("input_tokens", prompt_tokens)
                elif event_type == "message_delta":
                    usage = event.get("usage") or {}
                    completion_tokens = usage.get("output_tokens", completion_tokens)
        return "".join(chunks), prompt_tokens, completion_tokens


def create_real_provider_from_env() -> MiniMaxModelProvider:
    return MiniMaxModelProvider(ProviderConfig.from_env())
