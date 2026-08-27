from uuid import uuid4

import pytest

from reso_agent.context.builder import ContextBuilder
from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMode,
    AgentTurnRequest,
    MemoryRecord,
    MemoryType,
    RecentMessage,
    RelationshipContext,
)
from reso_agent.models.provider import DeterministicModelProvider
from reso_agent.presence.state import PresenceBuilder, PresenceContinuity
from reso_agent.runtime.pipeline import AgentRuntime


def _memory(summary: str, memory_type: MemoryType = MemoryType.EPISODIC) -> MemoryRecord:
    from datetime import UTC, datetime

    moment = datetime.now(UTC)
    return MemoryRecord(
        id=uuid4(),
        user_id=uuid4(),
        type=memory_type,
        summary=summary,
        occurred_at=moment,
        created_at=moment,
    )


def test_presence_first_meeting() -> None:
    state = PresenceBuilder().build(relationship=None, memories=[], recent_messages=[])
    assert state.continuity is PresenceContinuity.FIRST_MEETING
    assert "第一次" in state.summary


def test_presence_ongoing_counts_shared_memories() -> None:
    state = PresenceBuilder().build(
        relationship=RelationshipContext(state="developing", summary="x", interaction_count=7),
        memories=[_memory("a"), _memory("b")],
        recent_messages=[RecentMessage(id=uuid4(), role="user", content="hi")],
    )
    assert state.continuity is PresenceContinuity.ONGOING
    assert state.together_turns == 7
    assert state.shared_memories == 2
    assert "7" in state.summary and "2" in state.summary


def test_presence_returning_when_history_without_recent_window() -> None:
    state = PresenceBuilder().build(
        relationship=RelationshipContext(state="paused", summary="x", interaction_count=12),
        memories=[_memory("a")],
        recent_messages=[],
    )
    assert state.continuity is PresenceContinuity.RETURNING


def test_presence_summary_enters_system_context() -> None:
    context = ContextBuilder().build(
        message="今天怎么样",
        authorized=AgentAuthorizedContext(
            relationship=RelationshipContext(state="developing", summary="x", interaction_count=3),
            memories=[_memory("用户完成了项目第一阶段")],
            recent_messages=[RecentMessage(id=uuid4(), role="user", content="在吗")],
        ),
    )
    assert "[Presence]" in context.system_context
    assert "3" in context.presence.summary


@pytest.mark.asyncio
async def test_consent_seam_allows_bounded_proxy_when_granted() -> None:
    runtime = AgentRuntime(model_provider=DeterministicModelProvider())
    request = AgentTurnRequest(
        request_id=uuid4(),
        user_id=uuid4(),
        agent_id=uuid4(),
        conversation_id=uuid4(),
        message="帮我去广场看看有没有值得认识的人",
        requested_mode=AgentMode.PROXY,
        persona_version_id=None,
        context=AgentAuthorizedContext(active_proxy_consent=True),
    )
    details = await runtime.turn_with_details(request)
    assert details.trace.policy_decision.value == "ALLOW"
    assert details.trace.policy_reason == "active-consent"
    assert details.response.message  # proceeds to a real (bounded) generation


@pytest.mark.asyncio
async def test_consent_seam_still_fails_closed_without_grant() -> None:
    runtime = AgentRuntime(model_provider=DeterministicModelProvider())
    request = AgentTurnRequest(
        request_id=uuid4(),
        user_id=uuid4(),
        agent_id=uuid4(),
        conversation_id=uuid4(),
        message="帮我去广场看看",
        requested_mode=AgentMode.PROXY,
        persona_version_id=None,
        context=AgentAuthorizedContext(),
    )
    details = await runtime.turn_with_details(request)
    assert details.trace.policy_decision.value == "ASK_USER"
    assert "授权" in details.response.message
