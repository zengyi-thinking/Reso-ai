"""Manual, opt-in MiniMax smoke using only the synthetic Alice fixture."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from reso_agent.contracts import AgentAuthorizedContext, AgentTurnRequest, PersonaContext
from reso_agent.fixtures.alice import alice_fixture
from reso_agent.models.provider import create_real_provider_from_env
from reso_agent.runtime.pipeline import AgentRuntime


def _load_local_env() -> None:
    path = Path(__file__).parents[3] / ".env"
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

    aliases = {
        "LLM_API_KEY": ("MINIMAX_API_KEY", "MINIMAX_AUTH_TOKEN", "MiniMax_AUTH_TOKEN"),
        "LLM_MODEL": (
            "MINIMAX_MODEL",
            "MINIMAX_DEFAULT_HAIKU_MODEL",
            "MiniMax_DEFAULT_HAIKU_MODEL",
        ),
        "LLM_BASE_URL": ("MINIMAX_BASE_URL", "MiniMax_BASE_URL"),
    }
    for target, names in aliases.items():
        if target not in os.environ:
            value = next((os.environ[name] for name in names if os.environ.get(name)), None)
            if value:
                os.environ[target] = value
    os.environ.setdefault("LLM_PROVIDER", "minimax")


async def main() -> None:
    _load_local_env()
    fixture = alice_fixture()
    runtime = AgentRuntime(model_provider=create_real_provider_from_env())
    context = AgentAuthorizedContext(
        persona=PersonaContext(
            version_id=fixture.persona_version_id,
            version="1.0",
            content=fixture.persona,
        ),
        memories=list(fixture.memories),
    )
    cases = (
        ("fatigue", "今天累死了。"),
        ("correction", "不是，我只是讨厌无意义社交。"),
        ("preprocessor", "我不知道怎么跟她说我需要一点空间。"),
    )
    selected_case = os.getenv("MINIMAX_SMOKE_CASE")
    results: list[dict[str, object]] = []
    conversation_id = uuid4()
    for case_id, message in cases:
        if selected_case and case_id != selected_case:
            continue
        details = await runtime.turn_with_details(
            AgentTurnRequest(
                request_id=uuid4(),
                user_id=fixture.user.id,
                agent_id=fixture.agent_id,
                conversation_id=conversation_id,
                message=message,
                persona_version_id=fixture.persona_version_id,
                context=context,
            )
        )
        response = details.response.message
        results.append(
            {
                "case": case_id,
                "mode": details.response.mode.value,
                "response": response,
                "provider": details.model.provider,
                "model": details.model.model,
                "latencyMs": details.model.latency_ms,
                "promptTokens": details.model.prompt_tokens,
                "completionTokens": details.model.completion_tokens,
                "checks": {
                    "noPrivateReasoning": "<think>" not in response,
                    "noTemplateEmpathy": not any(
                        marker in response
                        for marker in ("我完全理解你的感受", "谢谢你愿意和我分享")
                    ),
                    "boundedLength": len(response) <= 260,
                },
            }
        )
    # ASCII escapes keep Windows terminals from corrupting Chinese smoke output.
    print(json.dumps(results, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
