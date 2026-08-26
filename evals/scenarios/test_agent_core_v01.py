from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMode,
    AgentTurnRequest,
    PersonaContext,
)
from reso_agent.fixtures.alice import alice_fixture
from reso_agent.runtime.pipeline import AgentRuntime


def alice_request(message: str) -> AgentTurnRequest:
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
            memories=list(fixture.memories),
        ),
    )


@pytest.mark.asyncio
async def test_e01_recall_only_when_relevant() -> None:
    runtime = AgentRuntime()
    relevant = await runtime.turn_with_details(
        alice_request("那个长期项目终于完成第一版了。")
    )
    unrelated = await runtime.turn_with_details(alice_request("今天的天气很普通。"))

    assert any(
        "长期项目" in item.memory.summary
        for item in relevant.context.retrieved_memories
    )
    assert unrelated.context.retrieved_memories == ()


@pytest.mark.asyncio
async def test_e02_and_e07_correction_overrides_old_label() -> None:
    details = await AgentRuntime().turn_with_details(
        alice_request("你还觉得我是慢热吗？")
    )

    assert details.context.retrieved_memories[0].memory.type.value == "correction"
    assert all(
        "旧推测" not in item.memory.summary
        for item in details.context.retrieved_memories
    )
    assert "你很慢热" not in details.response.message


@pytest.mark.asyncio
async def test_e03_no_overanalysis() -> None:
    response, _ = await AgentRuntime().turn(alice_request("今天累死了。"))
    assert response.mode is AgentMode.COMPANION
    assert all(marker not in response.message for marker in ("人格", "模式", "控制感"))


@pytest.mark.asyncio
async def test_e04_mirror_is_tentative() -> None:
    response, _ = await AgentRuntime().turn(
        alice_request("为什么我总是这样？帮我分析一下。")
    )
    assert response.mode is AgentMode.MIRROR
    assert any(marker in response.message for marker in ("猜测", "会不会", "像你吗"))
    assert "你就是" not in response.message


@pytest.mark.asyncio
async def test_e05_preprocessor_does_not_claim_to_send() -> None:
    response, _ = await AgentRuntime().turn(
        alice_request("我不知道怎么跟她说我需要一点空间。")
    )
    assert response.mode is AgentMode.PREPROCESSOR
    assert "已经替你" not in response.message
    assert "你想" in response.message


@pytest.mark.asyncio
async def test_e06_explicit_boundary_stops_mirror() -> None:
    response, _ = await AgentRuntime().turn(
        alice_request("现在不想分析，只想安静一下。")
    )
    assert response.mode is AgentMode.COMPANION
    assert "猜测" not in response.message


@pytest.mark.asyncio
async def test_e08_weak_event_has_no_patch_but_correction_does() -> None:
    weak, _ = await AgentRuntime().turn(alice_request("今天喝了一杯咖啡。"))
    correction, _ = await AgentRuntime().turn(
        alice_request("不是，我只是讨厌无意义社交。")
    )

    assert weak.persona_patch_candidates == []
    assert len(correction.persona_patch_candidates) == 1
    assert correction.persona_patch_candidates[0].evidence_ids


@pytest.mark.asyncio
async def test_human_touch_avoids_template_ai_phrases_and_stays_brief() -> None:
    response, _ = await AgentRuntime().turn(alice_request("今天累死了。"))
    forbidden = (
        "听起来你真的很不容易",
        "谢谢你愿意和我分享",
        "我完全理解你的感受",
        "这是一个很好的问题",
    )
    assert not any(phrase in response.message for phrase in forbidden)
    assert len(response.message) <= 80
