from datetime import UTC, datetime
from typing import ClassVar
from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentAuthorizedContext,
    MemoryRecord,
    MemoryType,
    PersonaContext,
)
from reso_agent.fixtures.alice import alice_fixture
from reso_agent.models.provider import (
    ModelProvider,
    ModelRequest,
    ModelResponse,
)
from reso_agent.pattern.detector import PatternDetector
from reso_agent.reflection.service import ReflectionService
from reso_agent.runtime.pipeline import AgentRuntime
from reso_agent.runtime.verification import separates_fact_from_interpretation


def _memory(summary: str, memory_type: MemoryType = MemoryType.EPISODIC) -> MemoryRecord:
    moment = datetime.now(UTC)
    return MemoryRecord(
        id=uuid4(),
        user_id=uuid4(),
        type=memory_type,
        summary=summary,
        occurred_at=moment,
        created_at=moment,
    )


def test_separation_markers_pass_and_bare_conclusion_fails() -> None:
    assert separates_fact_from_interpretation("回复变少和不愿意回应是两回事。")
    assert separates_fact_from_interpretation("你可能只是累了。")
    assert not separates_fact_from_interpretation("她不喜欢你了。")


def test_pattern_detector_requires_two_independent_evidences() -> None:
    detector = PatternDetector()
    assert detector.detect([_memory("用户完成了项目阶段一")]) == []

    patterns = detector.detect(
        [
            _memory("用户推进长期项目并感到开心"),
            _memory("用户又聊到长期项目的进展"),
        ]
    )
    assert patterns
    assert patterns[0].occurrences == 2
    assert len(patterns[0].evidence_ids) == 2


def test_pattern_detector_records_correction_as_exception() -> None:
    detector = PatternDetector()
    patterns = detector.detect(
        [
            _memory("用户在聚会上表现慢热"),
            _memory("用户又一次显得慢热"),
            _memory("用户明确纠正：并非慢热", memory_type=MemoryType.CORRECTION),
        ]
    )
    assert patterns
    assert patterns[0].exceptions
    assert patterns[0].confidence < 0.7


def test_reflection_patch_comes_from_pattern_not_hardcode() -> None:
    fixture = alice_fixture()
    from reso_agent.contracts import AgentTurnRequest

    request = AgentTurnRequest(
        request_id=uuid4(),
        user_id=fixture.user.id,
        agent_id=fixture.agent_id,
        conversation_id=uuid4(),
        message="最近又在推进那个长期项目。",
        persona_version_id=fixture.persona_version_id,
        context=AgentAuthorizedContext(
            persona=PersonaContext(
                version_id=fixture.persona_version_id,
                version="1.0",
                content=fixture.persona,
            ),
            memories=[
                _memory("用户推进长期项目并感到开心", MemoryType.PERSONA_RELATED),
                _memory("用户再次提到长期项目的新阶段", MemoryType.PERSONA_RELATED),
            ],
        ),
    )
    result = ReflectionService().reflect(
        request=request,
        is_correction=False,
        retrieved=request.context.memories
        and [
            type("Item", (), {"memory": m, "score": type("Score", (), {"semantic": 0.5})()})()
            for m in request.context.memories
        ],
    )
    assert result.persona_patch_candidates
    patch = result.persona_patch_candidates[0]
    assert patch.path.startswith("/uncertainHypotheses/")
    assert "模式检测" in patch.reason
    assert patch.evidence_ids


@pytest.mark.asyncio
async def test_reconsidered_retry_repairs_bare_conclusion() -> None:
    class BareThenSeparating(ModelProvider):
        name = "bare-then-separating"
        calls: ClassVar[list[str]] = []

        async def generate(self, request: ModelRequest) -> ModelResponse:
            from reso_agent.contracts import ModelMetadata

            self.calls.append(request.generation_phase)
            if request.generation_phase == "reconsider":
                if len(self.calls) < 3:  # first reconsider: bare conclusion
                    content = "她不喜欢你了。"
                else:  # retry: separated
                    content = "回复变少和不愿意回应是两回事；先看看事实。"
            elif request.generation_phase == "draft":
                content = "我第一反应是她变冷淡了，但先别当真。"
            else:
                content = "先慢一点。"
            return ModelResponse(
                content=content,
                metadata=ModelMetadata(
                    provider=self.name,
                    model="test",
                    latency_ms=1,
                    prompt_tokens=None,
                    completion_tokens=None,
                ),
            )

    fixture = alice_fixture()
    from reso_agent.contracts import AgentTurnRequest, RecentMessage

    request = AgentTurnRequest(
        request_id=uuid4(),
        user_id=fixture.user.id,
        agent_id=fixture.agent_id,
        conversation_id=uuid4(),
        message="她好像没以前那么愿意跟我聊天了。",
        persona_version_id=fixture.persona_version_id,
        context=AgentAuthorizedContext(
            persona=PersonaContext(
                version_id=fixture.persona_version_id,
                version="1.0",
                content=fixture.persona,
            ),
            recent_messages=[
                RecentMessage(id=uuid4(), role="user", content="她最近回复变少了。"),
                RecentMessage(id=uuid4(), role="agent", content="你在意这个变化。"),
            ],
        ),
    )
    details = await AgentRuntime(model_provider=BareThenSeparating()).turn_with_details(request)
    assert details.response.cadence.value == "reconsidered"
    assert details.fact_separation_verified is True
    assert "两回事" in details.response.message
    assert BareThenSeparating.calls.count("reconsider") == 2  # one retry only
