"""Growth-loop behavioral scenarios (deterministic route, no paid model calls).

E12 Corrective batches surface reviewable correction candidates.
E13 Weak transcripts produce no candidates at all - silence is the honest answer.
E14 Suggest-patch focus never leaks memory candidates.
"""

import json
from uuid import uuid4

from reso_agent.app import app  # noqa: F401  (boots router with deterministic route in CI)
from reso_agent.contracts import (
    AgentReflectionRequest,
    ModelMetadata,
    PersonaContext,
    PersonaContent,
    RecentMessage,
)
from reso_agent.models.provider import ModelProvider, ModelRequest, ModelResponse
from fastapi.testclient import TestClient

import pytest


class _ScriptedProvider(ModelProvider):
    """Mirrors what a well-behaved real model should return for this prompt."""

    name = "scripted-growth"
    model = "reso-relational-v1"

    async def generate(self, request: ModelRequest, on_text=None) -> ModelResponse:
        payload = json.loads(request.user_message)
        corrections = [
            row
            for row in payload.get("transcript", [])
            if row.get("role") == "user"
            and any(m in row.get("content", "") for m in ("不是", "其实"))
        ]
        memories = []
        patches = []
        for row in corrections[:1]:
            memories.append(
                {
                    "type": "correction",
                    "summary": "用户明确纠正了此前的解释，应以本次表达为准。",
                    "evidenceMessageIds": [row["id"]],
                    "confidence": 0.9,
                }
            )
            if payload.get("persona"):
                patches.append(
                    {
                        "path": "/confirmedPatterns/socialRhythm",
                        "oldValue": None,
                        "proposedValue": "对低价值社交主动性低",
                        "reason": "用户在对话中明确纠正了旧标签。",
                        "evidenceIds": [row["id"]],
                        "confidence": 0.86,
                    }
                )
        content = json.dumps(
            {"memoryCandidates": memories, "personaPatchCandidates": patches},
            ensure_ascii=False,
        )
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

    async def embed(self, texts):
        raise AssertionError("growth loop scenarios never call embeddings")


def _request(
    transcript: list[tuple[str, str]], persona: bool = True
) -> AgentReflectionRequest:
    rows = [
        RecentMessage(id=row_id, role=role, content=text)
        for row_id, role, text in transcript
    ]
    return AgentReflectionRequest(
        user_id=uuid4(),
        conversation_id=uuid4(),
        message_ids=[rows[-1].id],
        transcript=rows,
        persona=(
            PersonaContext(version_id=uuid4(), version="v1.0", content=PersonaContent())
            if persona
            else None
        ),
        memories=[],
    )


@pytest.mark.asyncio
async def test_e12_corrective_batch_yields_reviewable_correction() -> None:
    from reso_agent.runtime.reflection_tasks import ReflectionTaskRuntime

    runtime = ReflectionTaskRuntime(_ScriptedProvider())
    request = _request(
        [
            (str(uuid4()), "agent", "你听起来是个慢热的人。"),
            (str(uuid4()), "user", "上次你说我慢热，其实我只是不喜欢无意义的社交。"),
        ]
    )
    response = await runtime.reflect(request)
    assert len(response.memory_candidates) == 1
    candidate = response.memory_candidates[0]
    assert candidate.type == "correction"
    assert candidate.requires_review is True
    assert candidate.confidence >= 0.85


@pytest.mark.asyncio
async def test_e13_weak_batch_stays_silent() -> None:
    from reso_agent.runtime.reflection_tasks import ReflectionTaskRuntime

    runtime = ReflectionTaskRuntime(_ScriptedProvider())
    request = _request(
        [
            (str(uuid4()), "user", "今天天气不错。"),
            (str(uuid4()), "agent", "是啊，适合出去走走。"),
        ],
        persona=True,
    )
    response = await runtime.reflect(request)
    assert response.memory_candidates == []
    assert response.persona_patch_candidates == []


@pytest.mark.asyncio
async def test_e14_patch_focus_does_not_leak_memory_candidates() -> None:
    from reso_agent.runtime.reflection_tasks import ReflectionTaskRuntime

    runtime = ReflectionTaskRuntime(_ScriptedProvider())
    request = _request(
        [(str(uuid4()), "user", "其实我不是不喜欢出门，只是需要先处理疲惫。")]
    )
    focused = await runtime.reflect(request, focus="patches")
    assert focused.memory_candidates == []
    assert len(focused.persona_patch_candidates) <= 1


def test_endpoint_contract_smoke() -> None:
    client = TestClient(app)
    body = {
        "userId": str(uuid4()),
        "conversationId": str(uuid4()),
        "messageIds": [str(uuid4())],
        "transcript": [{"id": str(uuid4()), "role": "user", "content": "天气不错。"}],
        "persona": None,
        "memories": [],
    }
    weak = client.post("/v1/agent/reflect", json=body)
    assert weak.status_code == 200
    assert weak.json()["memoryCandidates"] == []
