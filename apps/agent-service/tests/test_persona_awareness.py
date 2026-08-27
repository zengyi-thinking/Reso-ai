from uuid import uuid4

from reso_agent.contracts import PersonaContent, PersonaContext
from reso_agent.persona.provider import PersonaProvider


def test_persona_awareness_question_selects_confirmed_manual_dimensions() -> None:
    selected = PersonaProvider().select(
        PersonaContext(
            version_id=uuid4(),
            version="v1.0",
            content=PersonaContent(
                values=["真诚"],
                communication_style={"preference": "有内容、直接但温和"},
                social_style={"rhythm": "少量但深入"},
                relationship_needs=["稳定的长期关系"],
                boundaries=["需要独处时先给一点空间"],
            ),
        ),
        "你现在对我了解多少？",
    )

    assert list(selected.fields) == [
        "values",
        "communication_style",
        "social_style",
        "relationship_needs",
        "boundaries",
    ]


def test_topic_question_selects_the_matching_persona_dimension() -> None:
    selected = PersonaProvider().select(
        PersonaContext(
            version_id=uuid4(),
            version="v1.0",
            content=PersonaContent(
                values=["真诚"],
                communication_style={"preference": "有内容、直接但温和"},
            ),
        ),
        "你觉得我更喜欢怎么沟通？",
    )

    assert list(selected.fields) == ["values", "communication_style"]
