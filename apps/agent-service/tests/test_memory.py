from datetime import UTC, datetime

from reso_agent.contracts import MemoryType
from reso_agent.fixtures.alice import CORRECTION_ID, OLD_SLOW_ID, alice_fixture
from reso_agent.memory.retriever import MemoryRetriever


def test_correction_outranks_and_suppresses_conflicting_reflection() -> None:
    results = MemoryRetriever().retrieve(
        query="我到底是不是很慢热，为什么讨厌无意义社交？",
        memories=list(alice_fixture().memories),
        now=datetime(2026, 8, 26, tzinfo=UTC),
    )

    assert results[0].memory.id == CORRECTION_ID
    assert results[0].memory.type is MemoryType.CORRECTION
    assert results[0].score.correction_boost == 0.35
    assert "correction override" in results[0].score.reason
    assert OLD_SLOW_ID not in {item.memory.id for item in results}


def test_irrelevant_memory_is_not_forced_into_context() -> None:
    results = MemoryRetriever().retrieve(
        query="今天的天气很普通",
        memories=list(alice_fixture().memories),
        now=datetime(2026, 8, 26, tzinfo=UTC),
    )
    assert results == []


def test_disabled_correction_does_not_participate() -> None:
    memories = [
        item.model_copy(update={"enabled": False}) if item.id == CORRECTION_ID else item
        for item in alice_fixture().memories
    ]
    results = MemoryRetriever().retrieve(
        query="慢热和无意义社交",
        memories=memories,
        now=datetime(2026, 8, 26, tzinfo=UTC),
    )
    assert CORRECTION_ID not in {item.memory.id for item in results}
    assert OLD_SLOW_ID in {item.memory.id for item in results}
