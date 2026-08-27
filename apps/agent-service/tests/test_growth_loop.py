"""Growth-loop unit coverage: hybrid retrieval, batch reflection honesty gate,
deep-recall tool semantics, and the shared reflection golden fixtures."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from reso_agent.contracts import (
    AgentReflectionRequest,
    AgentReflectionResponse,
    AgentTurnRequest,
    MemoryRecord,
    MemoryType,
    PersonaContent,
    PersonaContext,
    RecentMessage,
)
from reso_agent.memory.retriever import MemoryRetriever
from reso_agent.models.provider import ModelProvider, ModelRequest, ModelResponse
from reso_agent.runtime.reflection_tasks import ReflectionTaskRuntime
from reso_agent.tools.deep_recall import MemoryDeepRecallTool

FIXTURE_DIRECTORY = Path(__file__).parents[3] / "packages" / "contracts" / "fixtures"


def _memory(summary: str, *, type_: MemoryType = MemoryType.EPISODIC, **overrides) -> MemoryRecord:
    now = "2026-08-27T00:00:00+00:00"
    return MemoryRecord(
        id=uuid4(),
        user_id=uuid4(),
        type=type_,
        summary=summary,
        occurred_at=now,
        created_at=now,
        **overrides,
    )


class _FixedProvider(ModelProvider):
    """Returns a canned reflection payload so plan validation is exercised."""

    name = "fixed"
    model = "fixed"

    def __init__(self, content: str) -> None:
        self._content = content

    async def generate(self, request: ModelRequest, on_text=None) -> ModelResponse:
        return ModelResponse(
            content=self._content,
            metadata=self._metadata(),
        )

    async def embed(self, texts):
        raise AssertionError("embeddings are not used by reflection tasks")

    def _metadata(self):
        from reso_agent.contracts import ModelMetadata

        return ModelMetadata(
            provider=self.name,
            model=self.model,
            latency_ms=0,
            prompt_tokens=None,
            completion_tokens=None,
        )


def test_retriever_rescues_paraphrase_matches_with_vectors() -> None:
    retriever = MemoryRetriever()
    vector_memory = _memory("完全不同的字面内容讲台风研究")
    shared = [0.5, 0.5, 0.5, 0.5]
    # The vector-identical memory is admitted purely through cosine blending:
    # zero lexical overlap would otherwise exclude it outright.
    boosted = retriever.retrieve(
        query="随便什么查询词",
        memories=[
            vector_memory.model_copy(update={"embedding": shared}),
        ],
        query_embedding=shared,
        now=datetime(2026, 8, 27, tzinfo=UTC),
    )
    assert len(boosted) == 1
    score = boosted[0].score
    assert score.semantic > 0.3
    assert "vec=" in score.reason


def test_vector_below_floor_contributes_nothing_without_lexical_support() -> None:
    retriever = MemoryRetriever()
    orthogonal = [1.0, 0.0, 0.0, 0.0]
    perpendicular = [0.0, 1.0, 0.0, 0.0]
    memory = _memory("字面上毫不相关的长句子内容（避免巧合 bigram）xy")
    memory = memory.model_copy(update={"embedding": perpendicular})
    retrieved = retriever.retrieve(
        query="另一个话题的查询语句",
        memories=[memory],
        query_embedding=orthogonal,
        now=datetime(2026, 8, 27, tzinfo=UTC),
    )
    assert retrieved == []


def test_deep_recall_tool_trigger_matrix() -> None:
    tool = MemoryDeepRecallTool()
    assert tool.triggered("上次我们聊到团子的事") is True
    assert tool.triggered("今天天气不错") is False
    variants = tool.variants("还记得「咖啡杯」那次吗？")
    assert any("咖啡杯" in variant for variant in variants)
    result = tool.run(message="没有线索的消息", memories=[])
    assert result.ok and result.detail == "not-triggered"
    recall = tool.run(
        message="上次说过的事情",
        memories=[_memory("团子打翻了咖啡杯，我当时有点无奈", topics=["团子"])],
    )
    assert recall.ok


@pytest.mark.asyncio
async def test_reflection_task_materializes_pending_candidates_and_drops_unknown_evidence() -> None:
    good_message_id = str(uuid4())
    missing_id = str(uuid4())
    persona_version_id = uuid4()
    plan = {
        "memoryCandidates": [
            {
                "type": "correction",
                "summary": "用户纠正了旧标签",
                "evidenceMessageIds": [good_message_id, missing_id],
                "confidence": 0.9,
            }
        ],
        "personaPatchCandidates": [
            {
                "path": "/confirmedPatterns/socialRhythm",
                "oldValue": "慢热",
                "proposedValue": "对低价值社交主动性低",
                "reason": "明确纠正",
                "evidenceIds": [missing_id],
                "confidence": 0.86,
            }
        ],
    }
    content = json.dumps(plan, ensure_ascii=False)
    runtime = ReflectionTaskRuntime(_FixedProvider(content))
    request = AgentReflectionRequest(
        user_id=uuid4(),
        conversation_id=uuid4(),
        message_ids=[uuid4()],
        transcript=[
            RecentMessage(id=good_message_id, role="user", content="其实我讨厌无意义社交。"),
            RecentMessage(id=str(uuid4()), role="agent", content="嗯。"),
        ],
        persona=PersonaContext(
            version_id=persona_version_id,
            version="v1.0",
            content=PersonaContent(),
        ),
        memories=[],
    )

    # Mixed evidence (one unknown id) invalidates the memory candidate…
    response = await runtime.reflect(request)
    assert response.memory_candidates == []

    # …and the patch whose entire evidence list is unknown is dropped too.
    assert response.persona_patch_candidates == []

    clean_content = (
        '{"memoryCandidates":[],"personaPatchCandidates":[{"path":"/confirmedPatterns/socialRhythm",'
        '"oldValue":null,"proposedValue":"对低价值社交主动性低","reason":"明确纠正","evidenceIds":["'
        + good_message_id
        + '"],"confidence":0.86}]}'
    )
    clean_runtime = ReflectionTaskRuntime(_FixedProvider(clean_content))
    patched = await clean_runtime.reflect(request, focus="patches")
    assert patched.memory_candidates == []
    assert len(patched.persona_patch_candidates) == 1
    patch = patched.persona_patch_candidates[0]
    assert patch.status == "pending"
    assert patch.from_version_id == persona_version_id

    # Without a persona version nothing can reference a nonexistent version.
    bare_request = request.model_copy(update={"persona": None})
    bare = await clean_runtime.reflect(bare_request)
    assert bare.persona_patch_candidates == []


@pytest.mark.asyncio
async def test_suggest_patch_focus_never_returns_memory_candidates() -> None:
    runtime = ReflectionTaskRuntime(
        _FixedProvider('{"memoryCandidates":[],"personaPatchCandidates":[]}')
    )
    request = AgentReflectionRequest(
        user_id=uuid4(),
        conversation_id=uuid4(),
        message_ids=[uuid4()],
        transcript=[RecentMessage(id=str(uuid4()), role="user", content="随便。")],
        persona=None,
        memories=[],
    )
    focused = await runtime.reflect(request, focus="memories")
    assert isinstance(focused, AgentReflectionResponse)
    assert focused.memory_candidates == []


def test_shared_reflection_golden_fixtures() -> None:
    valid = json.loads((FIXTURE_DIRECTORY / "reflection.valid.json").read_text(encoding="utf-8"))
    invalid = json.loads(
        (FIXTURE_DIRECTORY / "reflection.invalid.json").read_text(encoding="utf-8")
    )
    assert AgentReflectionRequest.model_validate(valid["request"])
    assert AgentReflectionResponse.model_validate(valid["response"])
    with pytest.raises(ValueError):
        AgentReflectionRequest.model_validate(invalid["request"])
    with pytest.raises(ValueError):
        AgentReflectionResponse.model_validate(invalid["response"])


def test_turn_contract_fixture_still_valid_after_embedding_field() -> None:
    fixture = json.loads((FIXTURE_DIRECTORY / "agent-turn.valid.json").read_text(encoding="utf-8"))
    assert AgentTurnRequest.model_validate(fixture["request"])
