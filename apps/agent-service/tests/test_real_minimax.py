import os

import pytest

from reso_agent.contracts import AgentMessageEvent, LabSessionCreateRequest, LabTurnRequest
from reso_agent.lab import LabWorkspace


@pytest.mark.skipif(
    os.getenv("RUN_REAL_MINIMAX") != "1",
    reason="paid real-provider smoke is manual opt-in only",
)
@pytest.mark.asyncio
async def test_real_minimax_supports_three_breathing_turns() -> None:
    workspace = LabWorkspace()
    session = workspace.create_session(
        LabSessionCreateRequest(user_slug="user-alice", provider="real")
    )

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
