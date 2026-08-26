from uuid import uuid4

import pytest

from reso_agent.contracts import AgentMode, AgentTurnRequest
from reso_agent.runtime.mode_router import ModeRouter


def request(message: str, requested_mode: AgentMode | None = None) -> AgentTurnRequest:
    identifier = uuid4()
    return AgentTurnRequest(
        request_id=identifier,
        user_id=identifier,
        agent_id=identifier,
        conversation_id=identifier,
        message=message,
        requested_mode=requested_mode,
        persona_version_id=None,
    )


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("今天累死了。", AgentMode.COMPANION),
        ("我不知道怎么跟她说。", AgentMode.PREPROCESSOR),
        ("为什么我总是这样？帮我分析一下。", AgentMode.MIRROR),
        ("现在不想分析。", AgentMode.COMPANION),
        ("不是，我只是讨厌无意义社交。", AgentMode.COMPANION),
    ],
)
def test_routes_bounded_modes(message: str, expected: AgentMode) -> None:
    router = ModeRouter()
    perception = router.perceive(message)
    assert router.route(request(message), perception).mode is expected


def test_explicit_no_analysis_overrides_requested_mirror() -> None:
    router = ModeRouter()
    turn = request("现在不想分析。", AgentMode.MIRROR)
    assert router.route(turn, router.perceive(turn.message)).mode is AgentMode.COMPANION
