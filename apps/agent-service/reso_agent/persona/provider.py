from dataclasses import dataclass
from typing import Any, ClassVar

from reso_agent.contracts import PersonaContext


@dataclass(frozen=True)
class SelectedPersonaContext:
    version: str
    fields: dict[str, Any]


class PersonaProvider:
    """Selects read-only Personal Manual slices; it never commits a Persona version."""

    _KEYWORDS: ClassVar[dict[str, tuple[str, ...]]] = {
        "communication_style": ("表达", "回复", "怎么说", "沟通", "message", "reply"),
        "social_style": ("社交", "聚会", "朋友", "寒暄", "慢热"),
        "relationship_needs": ("关系", "她", "他", "伴侣", "朋友"),
        "boundaries": ("不想", "边界", "空间", "别分析", "拒绝"),
        "interests": ("项目", "兴趣", "喜欢", "周末"),
        "current_goals": ("目标", "计划", "项目", "最近"),
        "confirmed_patterns": ("总是", "每次", "模式", "为什么"),
        "uncertain_hypotheses": ("分析", "猜", "模式", "是不是"),
    }
    _PERSONA_AWARENESS_MARKERS: ClassVar[tuple[str, ...]] = (
        "了解我",
        "对我了解",
        "了解多少",
        "知道我",
        "记得我",
        "怎么看我",
        "对我的理解",
        "know about me",
    )

    def select(self, persona: PersonaContext | None, message: str) -> SelectedPersonaContext:
        if persona is None:
            return SelectedPersonaContext(version="unbound", fields={})

        # PersonaContent serializes to the cross-service camelCase contract by
        # default. Selection policy uses the Python field names, so keep this
        # internal representation in snake_case.
        content = persona.content.model_dump(by_alias=False)
        normalized_message = message.lower()
        persona_awareness = any(
            marker in normalized_message for marker in self._PERSONA_AWARENESS_MARKERS
        )
        selected_names = (
            [
                "values",
                "communication_style",
                "social_style",
                "relationship_needs",
                "boundaries",
            ]
            if persona_awareness
            else [
                name
                for name, markers in self._KEYWORDS.items()
                if any(marker in normalized_message for marker in markers)
            ]
        )
        if not selected_names:
            selected_names = ["values", "communication_style"]
        elif "values" not in selected_names:
            selected_names.insert(0, "values")

        selected: dict[str, Any] = {}
        field_budget = 5 if persona_awareness else 4
        for name in selected_names[:field_budget]:
            value = content.get(name)
            if value:
                selected[name] = value
        return SelectedPersonaContext(version=persona.version, fields=selected)
