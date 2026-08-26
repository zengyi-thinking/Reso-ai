from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, alias_generators


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


class AgentTurnRequest(ContractModel):
    request_id: UUID
    user_id: UUID
    agent_id: UUID
    conversation_id: UUID
    message: str = Field(min_length=1, max_length=20_000)
    requested_mode: AgentMode | None = None
    persona_version_id: UUID | None = None


class AgentTurnResponse(ContractModel):
    request_id: UUID
    message: str
    mode: AgentMode
    memory_candidates: list[MemoryCandidate]
    persona_patch_candidates: list[PersonaPatchCandidate]
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


class PersonaVersion(ContractModel):
    id: UUID
    profile_id: UUID
    version: int = Field(gt=0)
    content: PersonaContent
    change_summary: str
    confirmed_by_user: bool
    created_at: datetime


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
