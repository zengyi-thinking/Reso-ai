from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from reso_agent.contracts import AgentMode, ConversationCadence
from reso_agent.policy.disclosure import PolicyDecision


class TraceRecord(BaseModel):
    """Privacy-safe trace allowlist; unknown fields fail closed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    trace_id: UUID
    request_id: UUID
    mode: AgentMode
    policy_decision: PolicyDecision
    policy_reason: str = ""
    prompt_version: str
    model_route: str
    model: str = ""
    latency_ms: int = Field(default=0, ge=0)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    mode_reason: str = ""
    persona_version: str | None = None
    persona_fields: tuple[str, ...] = ()
    tool_names: tuple[str, ...] = ()
    retrieved_memory_ids: tuple[UUID, ...] = ()
    memory_candidate_ids: tuple[UUID, ...] = ()
    persona_candidate_ids: tuple[UUID, ...] = ()
    memory_candidate_count: int = Field(ge=0)
    persona_candidate_count: int = Field(ge=0)
    cadence: ConversationCadence = ConversationCadence.DIRECT
    public_event_types: tuple[str, ...] = ()
    public_evidence_refs: tuple[str, ...] = ()
