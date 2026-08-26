from uuid import uuid4

from reso_agent.context.builder import ContextBuilder
from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMode,
    AgentTurnRequest,
    ConversationCadence,
    RecentMessage,
)
from reso_agent.runtime.cadence import ConversationCadencePolicy
from reso_agent.runtime.mode_router import ModeRouter


def decide(message: str, *, history: bool = False) -> ConversationCadence:
    router = ModeRouter()
    perception = router.perceive(message)
    request = AgentTurnRequest(
        request_id=uuid4(),
        user_id=uuid4(),
        agent_id=uuid4(),
        conversation_id=uuid4(),
        message=message,
        requested_mode=AgentMode.MIRROR if "分析" in message else None,
    )
    selection = router.route(request, perception)
    recent_messages = (
        [
            RecentMessage(id=uuid4(), role="user", content="她最近回复少了。"),
            RecentMessage(id=uuid4(), role="agent", content="你有点在意这个变化。"),
        ]
        if history
        else []
    )
    context = ContextBuilder().build(
        message=message,
        authorized=AgentAuthorizedContext(recent_messages=recent_messages),
    )
    return (
        ConversationCadencePolicy()
        .decide(
            message=message,
            perception=perception,
            selection=selection,
            context=context,
        )
        .cadence
    )


def test_low_stakes_chat_is_direct() -> None:
    assert decide("晚上吃什么？") is ConversationCadence.DIRECT


def test_relationship_concern_is_considered() -> None:
    assert decide("她最近不太愿意跟我聊天了。") is ConversationCadence.CONSIDERED


def test_uncertain_invited_relationship_reflection_can_reconsider() -> None:
    assert (
        decide("帮我分析一下，她最近不太愿意跟我聊天了。", history=True)
        is ConversationCadence.RECONSIDERED
    )
