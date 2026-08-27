import json
from uuid import uuid4

from reso_agent.contracts import AgentTurnRequest, MemoryType
from reso_agent.reflection.service import ReflectionService
from reso_agent.runtime.public_output import parse_memory_candidate


def _request(message: str) -> AgentTurnRequest:
    return AgentTurnRequest(
        request_id=uuid4(),
        user_id=uuid4(),
        agent_id=uuid4(),
        conversation_id=uuid4(),
        message=message,
        persona_version_id=None,
    )


def test_parse_memory_candidate_uses_model_written_summary() -> None:
    raw = json.dumps(
        {
            "memory": {
                "type": "episodic",
                "summary": "长期项目终于交付第一版，用户说松了一口气。",
                "confidence": 0.85,
            },
            "events": [{"type": "message", "position": "final", "text": "辛苦了。"}],
        },
        ensure_ascii=False,
    )
    candidate = parse_memory_candidate(raw=raw, is_correction=False)
    assert candidate is not None
    assert candidate.summary.startswith("长期项目终于交付")
    assert candidate.type is MemoryType.EPISODIC
    assert candidate.confidence == 0.85


def test_parse_memory_candidate_rejects_template_and_invalid_shapes() -> None:
    template = json.dumps(
        {"memory": {"type": "episodic", "summary": "用户分享了一段当前经历。"}},
        ensure_ascii=False,
    )
    assert parse_memory_candidate(raw=template, is_correction=False) is None
    assert parse_memory_candidate(raw="not json", is_correction=False) is None
    assert parse_memory_candidate(raw=json.dumps({"events": []}), is_correction=False) is None


def test_parse_memory_candidate_rejects_verbatim_restatement() -> None:
    message = "我养了一只猫叫团子，今天它把我的咖啡杯碰倒了。"
    echo = json.dumps(
        {
            "memory": {
                "type": "episodic",
                "summary": "我养了一只猫叫团子，今天它把我的咖啡杯碰倒了。",
                "confidence": 0.8,
            }
        },
        ensure_ascii=False,
    )
    assert parse_memory_candidate(raw=echo, is_correction=False, message=message) is None
    # An observational summary in the model's own words still passes.
    observation = json.dumps(
        {
            "memory": {
                "type": "episodic",
                "summary": "团子（猫）打翻了咖啡杯，主人语气是无奈里带点宠溺。",
                "confidence": 0.8,
            }
        },
        ensure_ascii=False,
    )
    candidate = parse_memory_candidate(raw=observation, is_correction=False, message=message)
    assert candidate is not None
    assert candidate.summary.startswith("团子（猫）打翻了咖啡杯")


def test_parse_memory_candidate_forces_correction_type_when_user_corrected() -> None:
    raw = json.dumps(
        {"memory": {"type": "episodic", "summary": "我不慢热，只是讨厌无意义社交。"}},
        ensure_ascii=False,
    )
    candidate = parse_memory_candidate(raw=raw, is_correction=True)
    assert candidate is not None
    assert candidate.type is MemoryType.CORRECTION
    assert candidate.requires_review is True


def test_reflection_prefers_model_memory_over_fallback() -> None:
    result = ReflectionService().reflect(
        request=_request("长期项目终于交付了，挺开心的。"),
        is_correction=False,
        retrieved=(),
        model_memory=parse_memory_candidate(
            raw=json.dumps(
                {
                    "memory": {
                        "type": "episodic",
                        "summary": "长期项目交付第一版，用户很开心。",
                        "confidence": 0.9,
                    }
                },
                ensure_ascii=False,
            ),
            is_correction=False,
        ),
    )
    assert result.memory_candidates[0].summary == "长期项目交付第一版，用户很开心。"
    assert result.memory_candidates[0].confidence == 0.9


def test_fallback_quotes_actual_content_not_template() -> None:
    result = ReflectionService().reflect(
        request=_request("那个长期项目终于交付了，挺开心的。"),
        is_correction=False,
        retrieved=(),
    )
    summary = result.memory_candidates[0].summary
    assert "长期项目" in summary
    assert "分享" not in summary


def test_fallback_correction_quotes_user_words() -> None:
    result = ReflectionService().reflect(
        request=_request("不是，我只是讨厌无意义社交。"),
        is_correction=True,
        retrieved=(),
    )
    memory = result.memory_candidates[0]
    assert memory.type is MemoryType.CORRECTION
    assert "无意义社交" in memory.summary
    assert "并非普遍慢热" not in memory.summary
