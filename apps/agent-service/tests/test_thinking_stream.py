import json
from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentStatusEvent,
    AgentTurnRequest,
    ConversationCadence,
    ModelMetadata,
    PublicProcessMode,
)
from reso_agent.models.provider import ModelRequest, ModelResponse
from reso_agent.runtime.pipeline import AgentRuntime
from reso_agent.runtime.public_output import split_thinking


class _ThinkingProvider:
    """Streams designed public thinking lines before the JSON payload."""

    name = "thinking-fixture"

    def __init__(self, content: str) -> None:
        self._content = content

    async def generate(self, _request: ModelRequest, on_text=None) -> ModelResponse:
        if on_text is not None:
            chunks = [self._content[index : index + 7] for index in range(0, len(self._content), 7)]
            for chunk in chunks:
                on_text(chunk)
        return ModelResponse(
            content=self._content,
            metadata=ModelMetadata(
                provider=self.name,
                model="fixture",
                latency_ms=10,
                prompt_tokens=None,
                completion_tokens=None,
            ),
        )


def _request() -> AgentTurnRequest:
    return AgentTurnRequest(
        request_id=uuid4(),
        user_id=uuid4(),
        agent_id=uuid4(),
        conversation_id=uuid4(),
        message="我把项目交付的事跟朋友说了，他也在等我的结果。",
        persona_version_id=None,
        context=AgentAuthorizedContext(),
    )


def test_split_thinking_extracts_lines_and_payload() -> None:
    content = "> 翻到长期项目那条记忆\n> 在对比今天说的交付\n" + json.dumps(
        {"events": [{"type": "message", "position": "final", "text": "辛苦了。"}]},
        ensure_ascii=False,
    )
    lines, payload = split_thinking(content)
    assert lines == ["翻到长期项目那条记忆", "在对比今天说的交付"]
    assert payload.startswith("{")


def test_split_thinking_passes_plain_content_through() -> None:
    lines, payload = split_thinking("我在。你想从哪一小段开始说？")
    assert lines == []
    assert payload == "我在。你想从哪一小段开始说？"


@pytest.mark.asyncio
async def test_thinking_lines_stream_live_and_stay_out_of_public_events() -> None:
    payload = json.dumps(
        {
            "memory": {
                "type": "episodic",
                "summary": "长期项目交付，语气里是松了口气。",
                "confidence": 0.8,
            },
            "events": [{"type": "message", "position": "final", "text": "交付这一版不容易。"}],
        },
        ensure_ascii=False,
    )
    content = "> 翻到长期项目那条记忆\n> 注意到语气里的如释重负\n" + payload
    live: list[AgentStatusEvent] = []
    details = await AgentRuntime(model_provider=_ThinkingProvider(content)).turn_with_details(
        _request(), on_progress=live.append
    )

    composing = [event for event in live if event.phase.value == "composing"]
    assert [event.text for event in composing] == [
        "翻到长期项目那条记忆",
        "注意到语气里的如释重负",
    ]
    # Thinking lines are live-only; the persisted public sequence stays bounded.
    assert details.thinking_steps == (
        "翻到长期项目那条记忆",
        "注意到语气里的如释重负",
    )
    persisted_phases = [
        event.phase.value
        for event in details.response.public_events
        if isinstance(event, AgentStatusEvent)
    ]
    assert "composing" not in persisted_phases
    assert details.response.message == "交付这一版不容易。"
    assert details.response.cadence is ConversationCadence.CONSIDERED
    assert details.response.memory_candidates[0].summary == "长期项目交付，语气里是松了口气。"
    assert details.trace.thinking_steps == details.thinking_steps


@pytest.mark.asyncio
async def test_relay_goes_quiet_once_payload_starts() -> None:
    payload = json.dumps(
        {"events": [{"type": "message", "position": "final", "text": "好。"}]}, ensure_ascii=False
    )
    # A late "> …" line after the JSON began must never become a status.
    content = "> 先听你说\n" + payload + "\n> 不该出现"
    live: list[AgentStatusEvent] = []
    details = await AgentRuntime(model_provider=_ThinkingProvider(content)).turn_with_details(
        _request(), on_progress=live.append
    )
    assert [event.text for event in live if event.phase.value == "composing"] == ["先听你说"]
    assert details.response.message == "好。"


@pytest.mark.asyncio
async def test_deep_process_fills_four_grounded_steps() -> None:
    payload = json.dumps(
        {"events": [{"type": "message", "position": "final", "text": "我们先认识一点点。"}]},
        ensure_ascii=False,
    )
    content = "> 注意到你问得很认真\n> 我把这轮记下来了\n" + payload
    live: list[AgentStatusEvent] = []
    request = _request().model_copy(
        update={"public_process_mode": PublicProcessMode.RELATIONSHIP_DEEP_DIVE}
    )

    await AgentRuntime(model_provider=_ThinkingProvider(content)).turn_with_details(
        request, on_progress=live.append
    )

    composing = [event for event in live if event.phase.value == "composing"]
    assert [event.step for event in composing] == [1, 2, 3, 4]
    assert [event.label for event in composing] == [
        "先找一个具体共鸣",
        "再看看边界",
        "比较相处的节奏",
        "最后预演一下难处",
    ]
    assert "暂时不做冲突预演" in composing[-1].text
