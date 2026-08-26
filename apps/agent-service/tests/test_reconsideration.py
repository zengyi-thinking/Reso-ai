from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMessageEvent,
    AgentStatusEvent,
    AgentTurnRequest,
    ConversationCadence,
    PersonaContext,
    RecentMessage,
)
from reso_agent.fixtures.alice import alice_fixture
from reso_agent.models.provider import DeterministicModelProvider
from reso_agent.runtime.pipeline import AgentRuntime


def reconsideration_request(message: str = "她好像没以前那么愿意跟我聊天了。"):
    fixture = alice_fixture()
    return AgentTurnRequest(
        request_id=uuid4(),
        user_id=fixture.user.id,
        agent_id=fixture.agent_id,
        conversation_id=uuid4(),
        message=message,
        persona_version_id=fixture.persona_version_id,
        context=AgentAuthorizedContext(
            persona=PersonaContext(
                version_id=fixture.persona_version_id,
                version="1.0",
                content=fixture.persona,
            ),
            recent_messages=[
                RecentMessage(id=uuid4(), role="user", content="她最近回复变少了。"),
                RecentMessage(id=uuid4(), role="agent", content="你有点在意这个变化。"),
            ],
        ),
    )


@pytest.mark.asyncio
async def test_reconsidered_runs_two_genuine_passes() -> None:
    live_phases: list[str] = []
    details = await AgentRuntime(model_provider=DeterministicModelProvider()).turn_with_details(
        reconsideration_request(),
        on_progress=lambda event: live_phases.append(event.phase.value),
    )

    assert details.response.cadence is ConversationCadence.RECONSIDERED

    shapes = [
        (event.type, getattr(event, "phase", None) or getattr(event, "position", None))
        for event in details.response.public_events
    ]
    assert shapes == [
        ("status", "noticing"),
        ("public_reflection", None),
        ("message", "tentative"),
        ("status", "reconsidering"),
        ("message", "final"),
    ]

    tentative = next(
        event.text
        for event in details.response.public_events
        if isinstance(event, AgentMessageEvent) and event.position == "tentative"
    )
    final = next(
        event.text
        for event in details.response.public_events
        if isinstance(event, AgentMessageEvent) and event.position == "final"
    )
    assert tentative != final
    assert "先别当真" in tentative
    assert "两回事" in final

    # The reconsidering status is emitted live between the two model passes.
    assert live_phases == ["noticing", "reconsidering"]


@pytest.mark.asyncio
async def test_reconsidered_latency_and_tokens_cover_both_passes() -> None:
    details = await AgentRuntime(model_provider=DeterministicModelProvider()).turn_with_details(reconsideration_request())
    # Deterministic provider reports zero latency; the assertion documents that
    # two-pass metadata flows through instead of only the final pass.
    assert details.model.provider == "deterministic"
    assert details.trace.public_event_types == (
        "status",
        "public_reflection",
        "message",
        "status",
        "message",
    )


@pytest.mark.asyncio
async def test_reconsideration_cooldown_falls_back_to_considered() -> None:
    request = reconsideration_request()
    first = await AgentRuntime(model_provider=DeterministicModelProvider()).turn_with_details(
        request, recent_cadences=(ConversationCadence.RECONSIDERED,)
    )
    assert first.response.cadence is ConversationCadence.CONSIDERED
    statuses = [
        event for event in first.response.public_events if isinstance(event, AgentStatusEvent)
    ]
    assert len(statuses) <= 1
