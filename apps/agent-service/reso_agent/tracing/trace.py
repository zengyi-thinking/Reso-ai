from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from reso_agent.contracts import AgentMode
from reso_agent.policy.disclosure import PolicyDecision


class TraceRecord(BaseModel):
    """Privacy-safe trace allowlist; unknown fields fail closed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    trace_id: UUID
    request_id: UUID
    mode: AgentMode
    policy_decision: PolicyDecision
    prompt_version: str
    model_route: str
    tool_names: tuple[str, ...] = ()
    retrieved_memory_ids: tuple[UUID, ...] = ()
    memory_candidate_count: int = Field(ge=0)
    persona_candidate_count: int = Field(ge=0)
