from typing import Protocol


class RelationshipKnowledgeProvider(Protocol):
    def relevant_context(self, message: str) -> tuple[str, ...]: ...


class NullRelationshipKnowledgeProvider:
    """v0.1 intentionally carries no professional relationship corpus."""

    def relevant_context(self, message: str) -> tuple[str, ...]:
        del message
        return ()
