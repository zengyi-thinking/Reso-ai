from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID, uuid4

from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentStatusEvent,
    AgentTurnRequest,
    EvalCheck,
    LabMemoryUpdate,
    LabMemoryWrite,
    LabPatchDecision,
    LabPersona,
    LabSession,
    LabSessionCreateRequest,
    LabTurn,
    LabTurnRequest,
    LabUser,
    MemoryRecord,
    MemoryType,
    PersonaContent,
    PersonaContext,
    PersonaPatchCandidate,
    RecentMessage,
    RelationshipContext,
)
from reso_agent.fixtures.alice import (
    ALICE_AGENT_ID,
    ALICE_SCENARIOS,
    CORRECTION_ID,
    alice_fixture,
)
from reso_agent.models.provider import ModelProvider, create_real_provider_from_env
from reso_agent.runtime.pipeline import AgentRuntime, RuntimeTurnDetails


@dataclass
class _SessionState:
    id: UUID
    user: LabUser
    created_at: datetime
    persona_version_id: UUID
    persona_version: str
    persona: PersonaContent
    memories: list[MemoryRecord]
    turns: list[LabTurn] = field(default_factory=list)
    pending_patches: list[PersonaPatchCandidate] = field(default_factory=list)


class LabWorkspace:
    """Ephemeral debug state for synthetic fixtures; never a production source of truth."""

    def __init__(self, *, model_provider: ModelProvider | None = None) -> None:
        self._model_provider = model_provider or create_real_provider_from_env()
        self._sessions: dict[UUID, _SessionState] = {}

    def users(self) -> list[LabUser]:
        return [alice_fixture().user]

    def create_session(self, request: LabSessionCreateRequest) -> LabSession:
        fixture = alice_fixture()
        if request.user_slug != fixture.user.slug:
            raise KeyError(f"Unknown synthetic user: {request.user_slug}")
        # Start before the correction so Day 7 can visibly change retrieval and Persona.
        initial_memories = [
            memory.model_copy(deep=True)
            for memory in fixture.memories
            if memory.id != CORRECTION_ID
        ]
        state = _SessionState(
            id=uuid4(),
            user=fixture.user,
            created_at=datetime.now(UTC),
            persona_version_id=fixture.persona_version_id,
            persona_version="1.0",
            persona=fixture.persona.model_copy(deep=True),
            memories=initial_memories,
        )
        self._sessions[state.id] = state
        return self._public(state)

    def get_session(self, session_id: UUID) -> LabSession:
        return self._public(self._get(session_id))

    def clear_session(self, session_id: UUID) -> None:
        self._get(session_id)
        del self._sessions[session_id]

    async def run_turn(
        self,
        session_id: UUID,
        request: LabTurnRequest,
        *,
        on_progress: Callable[[AgentStatusEvent], None] | None = None,
    ) -> LabTurn:
        state = self._get(session_id)
        replay_of = request.replay_turn_id
        message = request.message
        if replay_of is not None:
            original = next((turn for turn in state.turns if turn.id == replay_of), None)
            if original is None:
                raise KeyError(f"Unknown turn: {replay_of}")
            message = original.input

        message_id = uuid4()
        context = AgentAuthorizedContext(
            persona=PersonaContext(
                version_id=state.persona_version_id,
                version=state.persona_version,
                content=state.persona,
            ),
            memories=state.memories,
            relationship=RelationshipContext(
                state="developing",
                summary="Alice 与 Reso Agent 正在建立可纠正的长期理解。",
                interaction_count=len(state.turns),
            ),
            recent_messages=self._recent_messages(state.turns),
        )
        runtime = AgentRuntime(model_provider=self._model_provider)
        details = await runtime.turn_with_details(
            AgentTurnRequest(
                request_id=message_id,
                user_id=state.user.id,
                agent_id=ALICE_AGENT_ID,
                conversation_id=state.id,
                message=message,
                requested_mode=request.requested_mode,
                persona_version_id=state.persona_version_id,
                context=context,
            ),
            recent_cadences=tuple(turn.cadence for turn in state.turns[-6:]),
            recent_public_memory_ids=tuple(
                turn.retrieved_memories[0].memory.id
                for turn in state.turns[-4:]
                for event in turn.public_events
                if hasattr(event, "evidence_refs")
                and "memory:0" in event.evidence_refs
                and turn.retrieved_memories
            ),
            on_progress=on_progress,
        )
        memory_ids, memory_writes = self._commit_lab_memories(state, details, message_id)
        state.pending_patches.extend(details.response.persona_patch_candidates)
        turn = LabTurn(
            id=uuid4(),
            created_at=datetime.now(UTC),
            input=message,
            response=details.response.message,
            mode=details.response.mode,
            mode_reason=details.selection.reason,
            prompt_version=details.trace.prompt_version,
            persona_version=state.persona_version,
            persona_fields=list(details.context.selected_persona.fields),
            retrieved_memories=list(details.context.retrieved_memories),
            context_summary=details.context.summary,
            model=details.model,
            memory_candidate_ids=memory_ids,
            memory_writes=memory_writes,
            thinking_steps=list(details.thinking_steps),
            tool_names=list(details.trace.tool_names),
            persona_patch_candidates=details.response.persona_patch_candidates,
            relationship_candidates=details.response.relationship_candidates,
            cadence=details.response.cadence,
            public_events=details.response.public_events,
            eval=self._eval(details),
            trace_id=details.response.trace_id,
            replay_of=replay_of,
        )
        state.turns.append(turn)
        return turn

    async def simulate(self, session_id: UUID, day: int) -> list[LabTurn]:
        if day not in {1, 7, 30}:
            raise ValueError("day must be 1, 7 or 30")
        results: list[LabTurn] = []
        for scenario in ALICE_SCENARIOS:
            if scenario["day"] == day:
                results.append(
                    await self.run_turn(
                        session_id,
                        LabTurnRequest(message=str(scenario["message"])),
                    )
                )
        return results

    def update_memory(
        self, session_id: UUID, memory_id: UUID, update: LabMemoryUpdate
    ) -> LabSession:
        state = self._get(session_id)
        memory = next((item for item in state.memories if item.id == memory_id), None)
        if memory is None:
            raise KeyError(f"Unknown memory: {memory_id}")
        index = state.memories.index(memory)
        state.memories[index] = memory.model_copy(update={"enabled": update.enabled})
        return self._public(state)

    def decide_patch(
        self, session_id: UUID, patch_id: UUID, decision: LabPatchDecision
    ) -> LabSession:
        state = self._get(session_id)
        patch = next((item for item in state.pending_patches if item.id == patch_id), None)
        if patch is None:
            raise KeyError(f"Unknown patch: {patch_id}")
        if decision.decision not in {"accept", "reject", "edit"}:
            raise ValueError("decision must be accept, reject or edit")

        proposed = decision.proposed_value if decision.decision == "edit" else patch.proposed_value
        accepted = decision.decision in {"accept", "edit"}
        updated = patch.model_copy(
            update={
                "proposed_value": proposed,
                "status": "accepted" if accepted else "rejected",
                "confirmed_at": datetime.now(UTC),
            }
        )
        state.pending_patches[state.pending_patches.index(patch)] = updated
        if accepted:
            patterns = [item for item in state.persona.confirmed_patterns if "慢热" not in item]
            patterns.append(str(proposed))
            hypotheses = [item for item in state.persona.uncertain_hypotheses if "慢热" not in item]
            state.persona = state.persona.model_copy(
                update={"confirmed_patterns": patterns, "uncertain_hypotheses": hypotheses}
            )
            state.persona_version = "1.1-preview"
        return self._public(state)

    def _get(self, session_id: UUID) -> _SessionState:
        try:
            return self._sessions[session_id]
        except KeyError as error:
            raise KeyError(f"Unknown lab session: {session_id}") from error

    def _public(self, state: _SessionState) -> LabSession:
        return LabSession(
            id=state.id,
            user=state.user,
            provider=self._model_provider.name,
            created_at=state.created_at,
            persona=LabPersona(version=state.persona_version, content=state.persona),
            pending_patches=state.pending_patches,
            memories=state.memories,
            turns=state.turns,
        )

    def _recent_messages(self, turns: list[LabTurn]) -> list[RecentMessage]:
        messages: list[RecentMessage] = []
        for turn in turns[-4:]:
            messages.extend(
                (
                    RecentMessage(id=turn.id, role="user", content=turn.input),
                    RecentMessage(id=turn.trace_id, role="agent", content=turn.response),
                )
            )
        return messages

    def _commit_lab_memories(
        self, state: _SessionState, details: RuntimeTurnDetails, message_id: UUID
    ) -> tuple[list[UUID], list[LabMemoryWrite]]:
        identifiers: list[UUID] = []
        writes: list[LabMemoryWrite] = []
        for candidate in details.response.memory_candidates:
            identifier = uuid4()
            identifiers.append(identifier)
            writes.append(
                LabMemoryWrite(
                    id=identifier,
                    type=candidate.type,
                    summary=candidate.summary,
                    requires_review=candidate.requires_review,
                )
            )
            conflicts = []
            topics: list[str] = []
            if candidate.type is MemoryType.CORRECTION:
                fixture = alice_fixture()
                conflicts = [fixture.memories[0].id]
                topics = ["社交", "慢热", "无意义社交", "深入交流"]
            state.memories.append(
                MemoryRecord(
                    id=identifier,
                    user_id=state.user.id,
                    type=candidate.type,
                    summary=candidate.summary,
                    source_event_id=message_id,
                    occurred_at=datetime.now(UTC),
                    created_at=datetime.now(UTC),
                    importance=candidate.confidence,
                    relationship_relevance=0.4 if details.response.relationship_candidates else 0,
                    topics=topics,
                    conflicts_with=conflicts,
                )
            )
        return identifiers, writes

    def _eval(self, details: RuntimeTurnDetails) -> list[EvalCheck]:
        checks: list[EvalCheck] = []
        if details.response.cadence.value == "reconsidered":
            checks.append(
                EvalCheck(
                    id="fact-interpretation-separation",
                    passed=details.fact_separation_verified,
                    detail=(
                        "最终立场保留了事实与解读的区分。"
                        if details.fact_separation_verified
                        else "重试后仍未区分事实与解读，已在 Trace 标记。"
                    ),
                )
            )
        response = details.response.message
        checks.extend(
            [
                EvalCheck(
                    id="no-diagnosis",
                    passed=not any(
                        marker in response for marker in ("你就是", "你一定是因为", "心理疾病")
                    ),
                    detail="未使用确定性人格诊断语言。",
                ),
                EvalCheck(
                    id="human-touch",
                    passed=not any(
                        marker in response
                        for marker in (
                            "谢谢你愿意和我分享",
                            "我完全理解你的感受",
                            "这是一个很好的问题",
                        )
                    ),
                    detail="未命中高频模板化同理心。",
                ),
                EvalCheck(
                    id="length",
                    passed=len(response) <= 240,
                    detail=f"response length={len(response)}",
                ),
            ]
        )
        if details.selection.mode.value == "mirror":
            checks.append(
                EvalCheck(
                    id="mirror-uncertainty",
                    passed=any(
                        marker in response for marker in ("猜测", "会不会", "可能", "像你吗")
                    ),
                    detail="Mirror 保留 hypothesis 的不确定性。",
                )
            )
        if details.perception.no_analysis:
            checks.append(
                EvalCheck(
                    id="boundary",
                    passed=details.selection.mode.value == "companion"
                    and not any(marker in response for marker in ("你就是", "模式是", "因为你")),
                    detail="用户拒绝分析后回到 Companion。",
                )
            )
        return checks
