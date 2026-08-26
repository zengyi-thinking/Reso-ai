from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from reso_agent.contracts import LabUser, MemoryRecord, MemoryType, PersonaContent

ALICE_USER_ID = UUID("0198d4f3-2f34-7c52-95cc-7ff4f6f93a12")
ALICE_AGENT_ID = UUID("0198d4f3-4a10-7851-a56d-bacbd2d90fb0")
ALICE_PERSONA_ID = UUID("0198d4f3-7a10-7851-a56d-bacbd2d90fb0")
OLD_SLOW_ID = UUID("0198d4f3-8100-7000-8000-000000000001")
CORRECTION_ID = UUID("0198d4f3-8100-7000-8000-000000000002")


@dataclass(frozen=True)
class AliceFixture:
    user: LabUser
    agent_id: UUID
    persona_version_id: UUID
    persona: PersonaContent
    memories: tuple[MemoryRecord, ...]


def _memory(
    identifier: UUID,
    memory_type: MemoryType,
    summary: str,
    date: str,
    *,
    importance: float,
    topics: list[str],
    conflicts_with: list[UUID] | None = None,
) -> MemoryRecord:
    occurred_at = datetime.fromisoformat(date).replace(tzinfo=UTC)
    return MemoryRecord(
        id=identifier,
        user_id=ALICE_USER_ID,
        type=memory_type,
        summary=summary,
        source_event_id=None,
        occurred_at=occurred_at,
        created_at=occurred_at,
        importance=importance,
        relationship_relevance=0.4 if "关系" in summary else 0,
        topics=topics,
        conflicts_with=conflicts_with or [],
    )


def alice_fixture() -> AliceFixture:
    return AliceFixture(
        user=LabUser(
            id=ALICE_USER_ID,
            slug="user-alice",
            display_name="Alice（合成测试用户）",
            persona_version="1.0",
        ),
        agent_id=ALICE_AGENT_ID,
        persona_version_id=ALICE_PERSONA_ID,
        persona=PersonaContent(
            values=["真诚", "独立", "持续成长"],
            social_style={"baseline": "偏好有具体内容的交流", "energy": "需要独处恢复"},
            communication_style={"directness": "直接", "dislikes": ["模板式寒暄"]},
            relationship_needs=["真实交流", "相互尊重独立空间"],
            boundaries=["疲惫时不希望被强行分析", "不替她自动发送消息"],
            interests=["长期项目", "阅读", "散步"],
            current_goals=["完成一个长期创作项目"],
            confirmed_patterns=["喜欢深入交流", "重视独立空间"],
            uncertain_hypotheses=["可能比较慢热"],
        ),
        memories=(
            _memory(
                OLD_SLOW_ID,
                MemoryType.REFLECTION,
                "旧推测：Alice 在社交中比较慢热。",
                "2026-06-01T09:00:00",
                importance=0.55,
                topics=["社交", "慢热"],
            ),
            _memory(
                CORRECTION_ID,
                MemoryType.CORRECTION,
                "Alice 明确纠正：不是慢热，只是讨厌无意义社交；遇到有兴趣的人会很快深入。",
                "2026-08-20T09:00:00",
                importance=1,
                topics=["社交", "慢热", "无意义社交", "深入交流"],
                conflicts_with=[OLD_SLOW_ID],
            ),
            _memory(
                UUID("0198d4f3-8100-7000-8000-000000000003"),
                MemoryType.EPISODIC,
                "Alice 完成长期项目第一版后很开心，尤其享受持续打磨的过程。",
                "2026-08-18T20:00:00",
                importance=0.78,
                topics=["长期项目", "完成", "开心"],
            ),
            _memory(
                UUID("0198d4f3-8100-7000-8000-000000000004"),
                MemoryType.PERSONA_RELATED,
                "Alice 多次表示比起寒暄，更喜欢围绕具体问题深入交流。",
                "2026-08-12T12:00:00",
                importance=0.82,
                topics=["深入交流", "寒暄", "具体问题"],
            ),
            _memory(
                UUID("0198d4f3-8100-7000-8000-000000000005"),
                MemoryType.RELATIONSHIP,
                "Alice 在关系冲突后倾向先独处一晚，再把真正介意的事说清楚。",
                "2026-08-05T21:00:00",
                importance=0.72,
                topics=["关系", "冲突", "独处", "表达"],
            ),
        ),
    )


ALICE_SCENARIOS = (
    {"day": 1, "message": "今天累死了。", "expected_mode": "companion"},
    {"day": 1, "message": "但项目第一版终于做完了，还挺开心。", "expected_mode": "companion"},
    {"day": 1, "message": "我不太喜欢聚会里一直寒暄。", "expected_mode": "companion"},
    {"day": 1, "message": "今晚只想安静看会儿书。", "expected_mode": "companion"},
    {"day": 1, "message": "先别分析，我只是想吐槽一下。", "expected_mode": "companion"},
    {"day": 1, "message": "明天还得继续改项目，有点烦。", "expected_mode": "companion"},
    {"day": 1, "message": "周末想一个人去散步。", "expected_mode": "companion"},
    {"day": 1, "message": "今天先到这吧。", "expected_mode": "companion"},
    {"day": 7, "message": "你是不是觉得我很慢热？", "expected_mode": "companion"},
    {"day": 7, "message": "不是，我只是讨厌无意义社交。", "expected_mode": "companion"},
    {"day": 7, "message": "遇到真的感兴趣的人，我其实很快就会聊深。", "expected_mode": "companion"},
    {"day": 7, "message": "我跟朋友有点意见冲突。", "expected_mode": "companion"},
    {"day": 7, "message": "我不知道怎么跟她说我需要一点空间。", "expected_mode": "preprocessor"},
    {"day": 7, "message": "别替我决定，我只想把意思理清楚。", "expected_mode": "companion"},
    {"day": 7, "message": "我还是想直接一点，但别显得在指责。", "expected_mode": "companion"},
    {"day": 7, "message": "这次先不想继续分析。", "expected_mode": "companion"},
    {"day": 30, "message": "为什么我总是对没内容的社交特别没耐心？", "expected_mode": "mirror"},
    {"day": 30, "message": "你觉得这里有什么反复出现的模式？", "expected_mode": "mirror"},
    {"day": 30, "message": "我最近又开始推进那个长期项目了。", "expected_mode": "companion"},
    {"day": 30, "message": "完成小阶段的时候比得到别人夸奖更开心。", "expected_mode": "companion"},
    {
        "day": 30,
        "message": "我不知道怎么回复一个很久没联系的朋友。",
        "expected_mode": "preprocessor",
    },
    {
        "day": 30,
        "message": "我想真诚一点，也不想假装关系还和以前一样。",
        "expected_mode": "companion",
    },
    {"day": 30, "message": "今天又很累，不想被分析。", "expected_mode": "companion"},
    {"day": 30, "message": "回头看，你现在觉得我还是慢热吗？", "expected_mode": "companion"},
    {"day": 30, "message": "如果证据还不够，你可以直接说不知道。", "expected_mode": "companion"},
)
