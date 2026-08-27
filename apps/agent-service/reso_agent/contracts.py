from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    alias_generators,
    field_validator,
    model_validator,
)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=alias_generators.to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class AgentMode(StrEnum):
    COMPANION = "companion"
    MIRROR = "mirror"
    PREPROCESSOR = "preprocessor"
    PROXY = "proxy"


class ConversationCadence(StrEnum):
    DIRECT = "direct"
    CONSIDERED = "considered"
    REFLECTIVE = "reflective"
    RECONSIDERED = "reconsidered"


class AgentStatusPhase(StrEnum):
    UNDERSTANDING = "understanding"
    RECALLING = "recalling"
    NOTICING = "noticing"
    COMPOSING = "composing"
    RECONSIDERING = "reconsidering"


class AgentStatusEvent(ContractModel):
    type: Literal["status"] = "status"
    phase: AgentStatusPhase
    text: str = Field(min_length=1, max_length=80)


class AgentPublicReflectionEvent(ContractModel):
    type: Literal["public_reflection"] = "public_reflection"
    text: str = Field(min_length=1, max_length=160)
    evidence_refs: list[str] = Field(min_length=1, max_length=3)

    @field_validator("evidence_refs")
    @classmethod
    def validate_evidence_refs(cls, value: list[str]) -> list[str]:
        allowed = re.compile(r"^(memory|persona):\d+$|^message:current$")
        if any(allowed.fullmatch(reference) is None for reference in value):
            raise ValueError("invalid public evidence reference")
        return value


class AgentMessageEvent(ContractModel):
    type: Literal["message"] = "message"
    position: Literal["tentative", "continuation", "final"]
    text: str = Field(min_length=1, max_length=600)


AgentPublicEvent = Annotated[
    AgentStatusEvent | AgentPublicReflectionEvent | AgentMessageEvent,
    Field(discriminator="type"),
]


class AgentPublicOutput(ContractModel):
    cadence: ConversationCadence
    events: list[AgentPublicEvent] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def validate_breathing_budget(self) -> Self:
        statuses = [event for event in self.events if isinstance(event, AgentStatusEvent)]
        reflections = [
            event for event in self.events if isinstance(event, AgentPublicReflectionEvent)
        ]
        messages = [event for event in self.events if isinstance(event, AgentMessageEvent)]
        if not any(message.position == "final" for message in messages):
            raise ValueError("public output requires a final message")
        if len(statuses) > 2 or len(reflections) > 1 or len(messages) > 2:
            raise ValueError("public output exceeds the breathing budget")
        return self


class AgentStreamCompleteEvent(ContractModel):
    type: Literal["complete"] = "complete"
    turn_id: UUID
    trace_id: UUID


class AgentStreamErrorEvent(ContractModel):
    type: Literal["error"] = "error"
    code: str
    text: str
    retryable: bool


class AgentMessageDeltaEvent(ContractModel):
    """Transport-level chunk of a message; the complete event always follows."""

    type: Literal["message_delta"] = "message_delta"
    text: str = Field(min_length=1, max_length=120)


AgentStreamEvent = Annotated[
    AgentStatusEvent
    | AgentPublicReflectionEvent
    | AgentMessageEvent
    | AgentMessageDeltaEvent
    | AgentStreamCompleteEvent
    | AgentStreamErrorEvent,
    Field(discriminator="type"),
]


class MemoryType(StrEnum):
    EPISODIC = "episodic"
    PERSONA_RELATED = "persona_related"
    RELATIONSHIP = "relationship"
    CORRECTION = "correction"
    REFLECTION = "reflection"


class MemoryCandidate(ContractModel):
    type: MemoryType
    summary: str
    evidence_message_ids: list[UUID] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    requires_review: bool


class MemoryRecord(ContractModel):
    id: UUID
    user_id: UUID
    type: MemoryType
    summary: str
    source_event_id: UUID | None = None
    occurred_at: datetime
    created_at: datetime
    importance: float = Field(default=0.5, ge=0, le=1)
    relationship_relevance: float = Field(default=0, ge=0, le=1)
    topics: list[str] = Field(default_factory=list)
    enabled: bool = True
    conflicts_with: list[UUID] = Field(default_factory=list)


class RetrievalScore(ContractModel):
    semantic: float = Field(ge=0)
    recency: float = Field(ge=0)
    importance: float = Field(ge=0)
    type: float = Field(ge=0)
    relationship: float = Field(ge=0)
    correction_boost: float = Field(ge=0)
    final: float = Field(ge=0)
    reason: str


class RetrievedMemory(ContractModel):
    memory: MemoryRecord
    score: RetrievalScore


class PersonaPatchCandidate(ContractModel):
    id: UUID
    user_id: UUID
    from_version_id: UUID
    path: str
    old_value: Any
    proposed_value: Any
    reason: str
    evidence_ids: list[UUID]
    confidence: float = Field(ge=0, le=1)
    status: str = "pending"
    created_at: datetime
    confirmed_at: datetime | None = None


class RelationshipUpdateCandidate(ContractModel):
    summary: str
    reason: str
    confidence: float = Field(ge=0, le=1)


class RecentMessage(ContractModel):
    id: UUID
    role: Literal["user", "agent"]
    content: str


class PersonaContext(ContractModel):
    version_id: UUID
    version: str
    content: PersonaContent


class RelationshipContext(ContractModel):
    state: str
    summary: str
    interaction_count: int = Field(ge=0)


class AgentAuthorizedContext(ContractModel):
    persona: PersonaContext | None = None
    memories: list[MemoryRecord] = Field(default_factory=list)
    relationship: RelationshipContext | None = None
    recent_messages: list[RecentMessage] = Field(default_factory=list)
    # Fail-closed seam: only Product API may set this after verifying an active,
    # unrevoked consent grant; absence always means "no proxy consent".
    active_proxy_consent: bool = False


class AgentTurnRequest(ContractModel):
    request_id: UUID
    user_id: UUID
    agent_id: UUID
    conversation_id: UUID
    message: str = Field(min_length=1, max_length=20_000)
    requested_mode: AgentMode | None = None
    persona_version_id: UUID | None = None
    context: AgentAuthorizedContext | None = None


class AgentTurnResponse(ContractModel):
    request_id: UUID
    message: str
    mode: AgentMode
    memory_candidates: list[MemoryCandidate]
    persona_patch_candidates: list[PersonaPatchCandidate]
    relationship_candidates: list[RelationshipUpdateCandidate]
    cadence: ConversationCadence = ConversationCadence.DIRECT
    public_events: list[AgentPublicEvent] = Field(default_factory=list)
    trace_id: UUID


class AgentReflectionRequest(ContractModel):
    user_id: UUID
    conversation_id: UUID
    message_ids: list[UUID] = Field(min_length=1)


class AgentReflectionResponse(ContractModel):
    memory_candidates: list[MemoryCandidate]
    persona_patch_candidates: list[PersonaPatchCandidate]


class JourneyAnswer(ContractModel):
    question_id: str
    choice_id: str


class PersonaInitializeRequest(ContractModel):
    user_id: UUID
    journey_id: UUID
    answers: list[JourneyAnswer]


class PersonaContent(ContractModel):
    identity: dict[str, Any] = Field(default_factory=dict)
    values: list[str] = Field(default_factory=list)
    social_style: dict[str, Any] = Field(default_factory=dict)
    communication_style: dict[str, Any] = Field(default_factory=dict)
    relationship_needs: list[str] = Field(default_factory=list)
    boundaries: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    current_goals: list[str] = Field(default_factory=list)
    confirmed_patterns: list[str] = Field(default_factory=list)
    uncertain_hypotheses: list[str] = Field(default_factory=list)


class ModelMetadata(ContractModel):
    provider: str
    model: str
    latency_ms: int = Field(ge=0)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)


class ContextSummary(ContractModel):
    persona_fields: list[str]
    memory_ids: list[UUID]
    recent_message_count: int = Field(ge=0)
    relationship_included: bool


class EvalCheck(ContractModel):
    id: str
    passed: bool
    detail: str


class LabUser(ContractModel):
    id: UUID
    slug: str
    display_name: str
    persona_version: str


class LabSessionCreateRequest(ContractModel):
    user_slug: str


class LabTurnRequest(ContractModel):
    message: str = Field(min_length=1, max_length=20_000)
    requested_mode: AgentMode | None = None
    replay_turn_id: UUID | None = None


class LabMemoryWrite(ContractModel):
    id: UUID
    type: MemoryType
    summary: str = Field(min_length=1)
    requires_review: bool


class LabTurn(ContractModel):
    id: UUID
    created_at: datetime
    input: str
    response: str
    mode: AgentMode
    mode_reason: str
    prompt_version: str
    persona_version: str
    persona_fields: list[str]
    retrieved_memories: list[RetrievedMemory]
    context_summary: ContextSummary
    model: ModelMetadata
    memory_candidate_ids: list[UUID]
    memory_writes: list[LabMemoryWrite] = Field(default_factory=list)
    # Designed public thinking lines the model streamed before its JSON payload.
    thinking_steps: list[str] = Field(default_factory=list)
    persona_patch_candidates: list[PersonaPatchCandidate]
    relationship_candidates: list[RelationshipUpdateCandidate]
    cadence: ConversationCadence
    public_events: list[AgentPublicEvent]
    eval: list[EvalCheck]
    trace_id: UUID
    replay_of: UUID | None = None


class LabPersona(ContractModel):
    version: str
    content: PersonaContent


class LabSession(ContractModel):
    id: UUID
    user: LabUser
    provider: str
    created_at: datetime
    persona: LabPersona
    pending_patches: list[PersonaPatchCandidate]
    memories: list[MemoryRecord]
    turns: list[LabTurn]


class LabMemoryUpdate(ContractModel):
    enabled: bool


class LabPatchDecision(ContractModel):
    decision: str
    proposed_value: Any | None = None


class PersonaVersion(ContractModel):
    id: UUID
    profile_id: UUID
    version: int = Field(gt=0)
    content: PersonaContent
    change_summary: str
    confirmed_by_user: bool
    created_at: datetime


class ReplyRoute(ContractModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=100)
    suggested_reply: str = Field(min_length=1, max_length=2_000)


class AnalyzeIncomingRequest(ContractModel):
    request_id: UUID
    idempotency_key: str = Field(min_length=1, max_length=200)
    requester_user_id: UUID
    connection_id: UUID
    source_message_id: UUID
    source_text: str = Field(min_length=1, max_length=8_000)
    sender_user_id: UUID
    agent_id: UUID
    trace_id: UUID


class AnalyzeIncomingResponse(ContractModel):
    interpretation: str = Field(min_length=1, max_length=4_000)
    reply_routes: list[ReplyRoute] = Field(max_length=5)
    trace_id: UUID


class PolishCandidate(ContractModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2_000)


class PolishDraftRequest(ContractModel):
    request_id: UUID
    idempotency_key: str = Field(min_length=1, max_length=200)
    requester_user_id: UUID
    connection_id: UUID
    draft: str = Field(min_length=1, max_length=2_000)
    reply_to_message_id: UUID | None
    agent_id: UUID
    trace_id: UUID


class PolishDraftResponse(ContractModel):
    candidates: list[PolishCandidate] = Field(min_length=1, max_length=5)
    trace_id: UUID


class TeaPartyAgentMessage(ContractModel):
    id: UUID
    turn_no: int = Field(ge=1, le=8)
    speaker_agent_id: UUID
    content: str = Field(min_length=1, max_length=2_000)
    created_at: datetime


class SocialActRequestV1(ContractModel):
    mission_id: UUID
    connection_id: UUID
    turn_no: int = Field(ge=1, le=8)
    speaker_agent_id: UUID
    listener_agent_id: UUID
    prior_messages: list[TeaPartyAgentMessage] = Field(max_length=8)
    disclosure_level: Literal["L2_SOCIAL"]
    max_content_length: int = Field(ge=1, le=2_000)
    idempotency_key: str = Field(min_length=1, max_length=200)
    trace_id: UUID


class DisclosureDecisionV1(ContractModel):
    decision: Literal["ALLOW", "DENY", "ASK_USER"]
    level: Literal[
        "L0_INTERNAL", "L1_PUBLIC", "L2_SOCIAL", "L3_RELATIONSHIP", "L4_PRIVATE", "L5_SECRET"
    ]
    reason_code: str = Field(min_length=1)


class SocialActResponseV1(ContractModel):
    speaker_agent_id: UUID
    content: str = Field(min_length=1, max_length=2_000)
    disclosure: DisclosureDecisionV1
    should_stop: bool
    stop_reason: (
        Literal[
            "max_turns",
            "agent_requested",
            "budget_exhausted",
            "consent_revoked",
            "relationship_blocked",
            "disclosure_blocked",
            "agent_failed",
            "cancelled",
        ]
        | None
    )
    trace_id: UUID
    agent_version_id: UUID | None = None


class SocialEvaluateRequestV1(ContractModel):
    mission_id: UUID
    messages: list[TeaPartyAgentMessage] = Field(min_length=1, max_length=8)
    trace_id: UUID


class TeaPartySummary(ContractModel):
    headline: str = Field(min_length=1, max_length=300)
    conversation_starter: str = Field(min_length=1, max_length=500)


class SocialEvaluateResponseV1(ContractModel):
    summary: TeaPartySummary
    trace_id: UUID


class MissionBudget(ContractModel):
    max_model_calls: int = Field(gt=0)
    max_tokens: int = Field(gt=0)


class SocialMission(ContractModel):
    mission_id: UUID
    initiator_agent_id: UUID
    target_agent_id: UUID
    goal: str
    max_turns: int = Field(gt=0, le=20)
    allowed_topics: list[str]
    forbidden_topics: list[str]
    disclosure_level: str
    budget: MissionBudget
    stop_conditions: list[str] = Field(min_length=1)


class SocialMissionResult(ContractModel):
    mission_id: UUID
    summary: str
    interesting_points: list[str]
    shared_topics: list[str]
    conflicts: list[str]
    open_questions: list[str]
    recommendation_candidate: bool
    confidence: float = Field(ge=0, le=1)
    turns_used: int = Field(ge=0)
    stop_reason: str


PersonaContext.model_rebuild()
AgentAuthorizedContext.model_rebuild()
