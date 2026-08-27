import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentMessageEvent,
    AnalyzeIncomingRequest,
    LabSessionCreateRequest,
    LabTurnRequest,
    PolishDraftRequest,
    SocialActRequestV1,
    SocialEvaluateRequestV1,
    TeaPartyAgentMessage,
)
from reso_agent.lab import LabWorkspace
from reso_agent.models.provider import create_real_provider_from_env
from reso_agent.runtime.product_tasks import ProductTaskRuntime


@pytest.mark.skipif(
    os.getenv("RUN_REAL_MINIMAX") != "1",
    reason="paid real-provider smoke is manual opt-in only",
)
@pytest.mark.asyncio
async def test_real_minimax_supports_three_breathing_turns() -> None:
    workspace = LabWorkspace()
    session = workspace.create_session(LabSessionCreateRequest(user_slug="user-alice"))

    turns = []
    for message in (
        "她最近好像没以前那么愿意跟我聊天了。",
        "你还记得我刚才在担心什么吗？",
        "那你觉得我现在需要立刻问她吗？",
    ):
        turns.append(await workspace.run_turn(session.id, LabTurnRequest(message=message)))

    assert [turn.context_summary.recent_message_count for turn in turns] == [0, 2, 4]
    assert all(turn.model.provider == "minimax" for turn in turns)
    assert all(turn.response.strip() for turn in turns)
    assert all(
        any(
            isinstance(event, AgentMessageEvent) and event.position == "final"
            for event in turn.public_events
        )
        for turn in turns
    )
    serialized = " ".join(
        event.model_dump_json() for turn in turns for event in turn.public_events
    ).lower()
    assert "<think>" not in serialized
    assert "reasoning_details" not in serialized


@pytest.mark.skipif(
    os.getenv("RUN_REAL_MINIMAX") != "1",
    reason="paid real-provider smoke is manual opt-in only",
)
@pytest.mark.asyncio
async def test_real_minimax_supports_assist_and_tea_party_contracts() -> None:
    tasks = ProductTaskRuntime(create_real_provider_from_env())
    requester_id = uuid4()
    connection_id = uuid4()
    sender_id = uuid4()
    agent_id = uuid4()
    other_agent_id = uuid4()
    trace_id = uuid4()

    analysis = await tasks.analyze_incoming(
        AnalyzeIncomingRequest(
            request_id=uuid4(),
            idempotency_key="real-assist-analysis",
            requester_user_id=requester_id,
            connection_id=connection_id,
            source_message_id=uuid4(),
            source_text="周末要不要一起找家安静的咖啡馆？",
            sender_user_id=sender_id,
            agent_id=agent_id,
            trace_id=trace_id,
        )
    )
    polished = await tasks.polish_draft(
        PolishDraftRequest(
            request_id=uuid4(),
            idempotency_key="real-assist-polish",
            requester_user_id=requester_id,
            connection_id=connection_id,
            draft="好啊，什么时候去",
            reply_to_message_id=None,
            agent_id=agent_id,
            trace_id=trace_id,
        )
    )
    social = await tasks.act_socially(
        SocialActRequestV1(
            mission_id=uuid4(),
            connection_id=connection_id,
            turn_no=1,
            speaker_agent_id=agent_id,
            listener_agent_id=other_agent_id,
            prior_messages=[],
            disclosure_level="L2_SOCIAL",
            max_content_length=2_000,
            idempotency_key="real-tea-party-turn-1",
            trace_id=trace_id,
        )
    )
    evaluated = await tasks.evaluate_social(
        SocialEvaluateRequestV1(
            mission_id=uuid4(),
            messages=[
                TeaPartyAgentMessage(
                    id=uuid4(),
                    turn_no=1,
                    speaker_agent_id=agent_id,
                    content=social.content,
                    created_at=datetime.now(UTC),
                )
            ],
            trace_id=trace_id,
        )
    )

    public_text = " ".join(
        [
            analysis.interpretation,
            *(route.suggested_reply for route in analysis.reply_routes),
            *(candidate.text for candidate in polished.candidates),
            social.content,
            evaluated.summary.headline,
            evaluated.summary.conversation_starter,
        ]
    ).lower()
    assert analysis.trace_id == trace_id
    assert polished.trace_id == trace_id
    assert social.trace_id == trace_id
    assert evaluated.trace_id == trace_id
    assert "<think>" not in public_text
    assert "reasoning_details" not in public_text
