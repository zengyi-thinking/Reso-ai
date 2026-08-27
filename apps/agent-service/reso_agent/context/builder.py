from __future__ import annotations

import json
from dataclasses import dataclass

from reso_agent.contracts import (
    AgentAuthorizedContext,
    ContextSummary,
    RecentMessage,
    RetrievedMemory,
)
from reso_agent.identity import RESO_AGENT_IDENTITY
from reso_agent.knowledge.provider import (
    NullRelationshipKnowledgeProvider,
    RelationshipKnowledgeProvider,
)
from reso_agent.memory.retriever import MemoryRetriever
from reso_agent.persona.provider import PersonaProvider, SelectedPersonaContext
from reso_agent.presence.state import PresenceBuilder, PresenceState


@dataclass(frozen=True)
class BuiltContext:
    system_context: str
    selected_persona: SelectedPersonaContext
    retrieved_memories: tuple[RetrievedMemory, ...]
    recent_messages: tuple[RecentMessage, ...]
    summary: ContextSummary
    presence: PresenceState


class ContextBuilder:
    """Builds a bounded, inspectable context from Product-authorized read inputs."""

    def __init__(
        self,
        *,
        persona_provider: PersonaProvider | None = None,
        memory_retriever: MemoryRetriever | None = None,
        knowledge_provider: RelationshipKnowledgeProvider | None = None,
        presence_builder: PresenceBuilder | None = None,
    ) -> None:
        self._persona_provider = persona_provider or PersonaProvider()
        self._memory_retriever = memory_retriever or MemoryRetriever()
        self._knowledge_provider = knowledge_provider or NullRelationshipKnowledgeProvider()
        self._presence_builder = presence_builder or PresenceBuilder()

    def build(self, *, message: str, authorized: AgentAuthorizedContext) -> BuiltContext:
        persona = self._persona_provider.select(authorized.persona, message)
        memories = tuple(
            self._memory_retriever.retrieve(query=message, memories=authorized.memories, top_k=5)
        )
        recent = tuple(authorized.recent_messages[-8:])
        knowledge = self._knowledge_provider.relevant_context(message)
        relationship = authorized.relationship
        presence = self._presence_builder.build(
            relationship=authorized.relationship,
            memories=authorized.memories,
            recent_messages=authorized.recent_messages,
        )

        sections = [f"[Agent Identity]\n{RESO_AGENT_IDENTITY}", f"[Presence]\n{presence.summary}"]
        if persona.fields:
            sections.append(
                "[Relevant Personal Manual]\n"
                + json.dumps(persona.fields, ensure_ascii=False, separators=(",", ":"))
            )
        if memories:
            memory_lines = [
                f"- {item.memory.type.value}: {item.memory.summary}" for item in memories
            ]
            sections.append("[Relevant Memories]\n" + "\n".join(memory_lines))
        if relationship:
            sections.append(
                f"[Relationship Context]\nstate={relationship.state}; "
                f"interactions={relationship.interaction_count}; {relationship.summary}"
            )
        if knowledge:
            sections.append("[Relationship Knowledge]\n" + "\n".join(knowledge))

        return BuiltContext(
            system_context="\n\n".join(sections),
            selected_persona=persona,
            retrieved_memories=memories,
            recent_messages=recent,
            presence=presence,
            summary=ContextSummary(
                persona_fields=list(persona.fields),
                memory_ids=[item.memory.id for item in memories],
                recent_message_count=len(recent),
                relationship_included=relationship is not None,
            ),
        )
