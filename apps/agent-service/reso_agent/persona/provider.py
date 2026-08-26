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

    def select(self, persona: PersonaContext | None, message: str) -> SelectedPersonaContext:
        if persona is None:
            return SelectedPersonaContext(version="unbound", fields={})

        content = persona.content.model_dump()
        selected_names = [
            name
            for name, markers in self._KEYWORDS.items()
            if any(marker in message.lower() for marker in markers)
        ]
        if not selected_names:
            selected_names = ["values", "communication_style"]
        elif "values" not in selected_names:
            selected_names.insert(0, "values")

        selected: dict[str, Any] = {}
        for name in selected_names[:4]:
            value = content.get(name)
            if value:
                selected[name] = value
        return SelectedPersonaContext(version=persona.version, fields=selected)
