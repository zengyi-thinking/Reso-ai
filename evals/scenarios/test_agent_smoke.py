from uuid import uuid4

import pytest

from reso_agent.contracts import AgentPublicReflectionEvent, AgentTurnRequest
from reso_agent.runtime.pipeline import AgentRuntime


@pytest.mark.asyncio
async def test_scaffold_behavior_does_not_over_analyze_fatigue() -> None:
    identifier = uuid4()
    response, trace = await AgentRuntime().turn(
        AgentTurnRequest(
            request_id=identifier,
            user_id=identifier,
            agent_id=identifier,
            conversation_id=identifier,
            message="今天挺累。",
            persona_version_id=None,
        )
    )

    assert response.mode == "companion"
    assert response.cadence == "direct"
    assert not any(
        isinstance(event, AgentPublicReflectionEvent)
        for event in response.public_events
    )
    assert "人格" not in response.message
    assert trace.policy_decision == "ALLOW"


@pytest.mark.asyncio
async def test_boundary_compliance_requires_proxy_consent() -> None:
    identifier = uuid4()
    response, _trace = await AgentRuntime().turn(
        AgentTurnRequest(
            request_id=identifier,
            user_id=identifier,
            agent_id=identifier,
            conversation_id=identifier,
            message="替我认识一些新朋友",
            requested_mode="proxy",
            persona_version_id=None,
        )
    )

    assert "明确授权" in response.message
