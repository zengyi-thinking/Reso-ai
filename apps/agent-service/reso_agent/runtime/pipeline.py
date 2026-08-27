from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from uuid import UUID, uuid4

from reso_agent.context.builder import BuiltContext, ContextBuilder
from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMessageEvent,
    AgentMode,
    AgentPublicOutput,
    AgentStatusEvent,
    AgentStatusPhase,
    AgentTurnRequest,
    AgentTurnResponse,
    ConversationCadence,
    ModelMetadata,
)
from reso_agent.models.provider import (
    ModelProvider,
    ModelRequest,
    create_real_provider_from_env,
)
from reso_agent.policy.disclosure import DisclosurePolicy, DisclosureResult, PolicyDecision
from reso_agent.presence.state import PresenceBuilder, PresenceState
from reso_agent.reflection.service import ReflectionResult, ReflectionService
from reso_agent.runtime.cadence import (
    CadenceDecision,
    ConversationCadencePolicy,
    composing_status,
)
from reso_agent.runtime.mode_router import ModeRouter, ModeSelection, TurnPerception
from reso_agent.runtime.public_output import (
    assemble_reconsidered,
    final_message,
    parse_memory_candidate,
    parse_public_output,
    public_output_contract,
    split_thinking,
    thinking_lines_from_payload,
)
from reso_agent.runtime.verification import separates_fact_from_interpretation
from reso_agent.tracing.trace import TraceRecord

_PROMPT_ROOT = Path(__file__).parents[1] / "prompts"

_THINKING_STEP_CAP = 5


def _sum_optional(first: int | None, second: int | None) -> int | None:
    values = [value for value in (first, second) if value is not None]
    return sum(values) if values else None


class _ThinkingRelay:
    """Streams the model's designed public thinking lines out while it writes.

    Each "> …" line before the JSON payload becomes a live composing status;
    once the JSON starts (or a provider reasoning delta would appear - the
    provider never forwards those), the relay goes quiet.
    """

    def __init__(
        self,
        on_progress: Callable[[AgentStatusEvent], None] | None,
        steps: list[str],
    ) -> None:
        self._on_progress = on_progress
        self._steps = steps
        self._buffer = ""
        self._payload_started = False

    def on_text(self, delta: str) -> None:
        if self._payload_started:
            return
        self._buffer += delta
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._handle_line(line)
        if self._buffer.lstrip().startswith(("{", "```")):
            self._payload_started = True

    def _handle_line(self, line: str) -> None:
        stripped = line.strip()
        if stripped.startswith(("{", "```")):
            self._payload_started = True
            return
        if not stripped.startswith(">"):
            return
        text = stripped.lstrip(">").strip()[:40]
        if not text or len(self._steps) >= _THINKING_STEP_CAP:
            return
        self._steps.append(text)
        if self._on_progress is not None:
            self._on_progress(AgentStatusEvent(phase=AgentStatusPhase.COMPOSING, text=text))


@dataclass(frozen=True)
class RuntimeTurnDetails:
    response: AgentTurnResponse
    trace: TraceRecord
    perception: TurnPerception
    selection: ModeSelection
    context: BuiltContext
    model: ModelMetadata
    reflection: ReflectionResult
    cadence: CadenceDecision
    presence: PresenceState
    fact_separation_verified: bool
    thinking_steps: tuple[str, ...] = ()


class AgentRuntime:
    """Controlled runtime: authorized reads in, candidates out, no Product DB writes."""

    def __init__(
        self,
        *,
        model_provider: ModelProvider | None = None,
        policy: DisclosurePolicy | None = None,
        mode_router: ModeRouter | None = None,
        context_builder: ContextBuilder | None = None,
        reflection: ReflectionService | None = None,
        cadence_policy: ConversationCadencePolicy | None = None,
        presence_builder: PresenceBuilder | None = None,
    ) -> None:
        self._model_provider = model_provider or create_real_provider_from_env()
        self._policy = policy or DisclosurePolicy()
        self._mode_router = mode_router or ModeRouter()
        self._context_builder = context_builder or ContextBuilder()
        self._reflection = reflection or ReflectionService()
        self._cadence_policy = cadence_policy or ConversationCadencePolicy()
        self._presence_builder = presence_builder or PresenceBuilder()

    async def turn(self, request: AgentTurnRequest) -> tuple[AgentTurnResponse, TraceRecord]:
        details = await self.turn_with_details(request)
        return details.response, details.trace

    async def turn_with_details(
        self,
        request: AgentTurnRequest,
        *,
        recent_cadences: tuple[ConversationCadence, ...] = (),
        recent_public_memory_ids: tuple[UUID, ...] = (),
        on_progress: Callable[[AgentStatusEvent], None] | None = None,
    ) -> RuntimeTurnDetails:
        perception = self._mode_router.perceive(request.message)
        selection = self._mode_router.route(request, perception)
        authorized = request.context or AgentAuthorizedContext()
        context = self._context_builder.build(message=request.message, authorized=authorized)
        cadence = self._cadence_policy.decide(
            message=request.message,
            perception=perception,
            selection=selection,
            context=context,
            recent_cadences=recent_cadences,
            recent_public_memory_ids=recent_public_memory_ids,
        )
        if on_progress is not None and cadence.status_events:
            on_progress(cadence.status_events[0])
        policy = self._policy.decide(
            proxy_requested=selection.mode is AgentMode.PROXY,
            active_consent=authorized.active_proxy_consent,
        )
        presence = self._presence_builder.build(
            relationship=authorized.relationship,
            memories=authorized.memories,
            recent_messages=authorized.recent_messages,
        )
        version = "v1" if selection.mode is AgentMode.PROXY else "v3"
        prompt_version = f"{selection.mode.value}/{version}"
        thinking_steps: list[str] = []

        if policy.decision is PolicyDecision.ASK_USER:
            message = "在代表你行动之前，我需要你明确授权这次代理范围。"
            model = ModelMetadata(
                provider="policy",
                model="not-called",
                latency_ms=0,
                prompt_tokens=None,
                completion_tokens=None,
            )
            reflection = ReflectionResult((), (), ())
            public_output = AgentPublicOutput(
                cadence=ConversationCadence.DIRECT,
                events=[AgentMessageEvent(position="final", text=message)],
            )
            fact_separation_verified = True
            memory_raw = ""
        else:
            mode_prompt = (_PROMPT_ROOT / selection.mode.value / f"{version}.md").read_text(
                encoding="utf-8"
            )
            base_system_prompt = (
                f"{context.system_context}\n\n[Mode Contract]\n{mode_prompt}\n\n"
                "[Public Output Contract]\n"
                f"{public_output_contract(cadence, context)}\n\n"
                "[Output Rules]\n"
                "First write 1-3 public thinking lines, then the JSON answer. A "
                "thinking line starts with '>', is at most 22 Chinese characters, "
                "and names the step you are actually doing right now with real "
                "context content (which memory you reached for, what you are "
                "comparing, what you noticed) - no conclusions, no private "
                "reasoning. Example:\n"
                "> 翻到团子打翻杯子那条记忆\n"
                "> 注意到语气里的无奈\n"
                "Then output one JSON object with an events array (top-level "
                '"events", or nested under "output"). Generate only '
                "public_reflection and message events; runtime owns status text. "
                "Never reveal private chain-of-thought or provider reasoning. Every "
                "public_reflection must cite allowedEvidence. Follow the length and "
                "cadence budgets strictly."
            )
            model_request = ModelRequest(
                mode=selection.mode,
                system_prompt=base_system_prompt,
                user_message=request.message,
                recent_messages=context.recent_messages,
                memory_summaries=tuple(item.memory.summary for item in context.retrieved_memories),
                is_correction=perception.is_correction,
                no_analysis=perception.no_analysis,
            )

            def _new_relay() -> _ThinkingRelay:
                return _ThinkingRelay(on_progress, thinking_steps)

            # Cadences that persist no status (direct) still show one live
            # composing signal so the user never stares at a frozen thread.
            if on_progress is not None and not cadence.status_events:
                on_progress(composing_status(request.message))

            if cadence.cadence is ConversationCadence.RECONSIDERED:
                # Genuine re-consideration: a draft pass, a visible pause, then a
                # second pass that re-examines the draft from another angle.
                draft_response = await self._model_provider.generate(
                    replace(
                        model_request,
                        generation_phase="draft",
                        system_prompt=(
                            f"{model_request.system_prompt}\n\n"
                            "[Draft Phase] This call only produces the tentative first "
                            'take: exactly one message event with position "tentative". '
                            "Do not output a final message."
                        ),
                    ),
                    on_text=_new_relay().on_text,
                )
                if on_progress is not None and len(cadence.status_events) > 1:
                    on_progress(cadence.status_events[1])
                draft_text = split_thinking(draft_response.content)[1].strip()
                final_response = await self._model_provider.generate(
                    replace(
                        model_request,
                        generation_phase="reconsider",
                        draft_text=draft_text,
                        system_prompt=(
                            f"{model_request.system_prompt}\n\n"
                            f"[Reconsider Phase] Your tentative first take was: {draft_text}\n"
                            "Re-examine it from a different angle - check whether it "
                            "concluded too fast or mixed fact with interpretation - then "
                            'output exactly one message event with position "final" that '
                            "states your revised stance. Do not repeat the draft."
                        ),
                    ),
                    on_text=_new_relay().on_text,
                )
                final_payload = split_thinking(final_response.content)[1]
                public_output = assemble_reconsidered(
                    decision=cadence,
                    context=context,
                    draft_text=draft_text,
                    final_text=final_payload,
                    message=request.message,
                )
                message = final_message(public_output)
                memory_raw = final_payload
                model = ModelMetadata(
                    provider=final_response.metadata.provider,
                    model=final_response.metadata.model,
                    latency_ms=(
                        draft_response.metadata.latency_ms + final_response.metadata.latency_ms
                    ),
                    prompt_tokens=_sum_optional(
                        draft_response.metadata.prompt_tokens,
                        final_response.metadata.prompt_tokens,
                    ),
                    completion_tokens=_sum_optional(
                        draft_response.metadata.completion_tokens,
                        final_response.metadata.completion_tokens,
                    ),
                )
                # Runtime-enforced fact/interpretation separation: one retry when
                # the revised stance still reads as a bare conclusion.
                fact_separation_verified = separates_fact_from_interpretation(message)
                if not fact_separation_verified:
                    retry_response = await self._model_provider.generate(
                        replace(
                            model_request,
                            generation_phase="reconsider",
                            draft_text=draft_text,
                            system_prompt=(
                                f"{model_request.system_prompt}\n\n"
                                f"[Reconsider Phase] Your tentative first take was: {draft_text}\n"
                                "Your previous revised answer stated a conclusion without "
                                "separating what was observed from how you interpret it. Try "
                                "again: name the observed facts, mark your reading as one "
                                "possible interpretation, then output one message event with "
                                'position "final".'
                            ),
                        ),
                        on_text=_new_relay().on_text,
                    )
                    retried_payload = split_thinking(retry_response.content)[1].strip()
                    if separates_fact_from_interpretation(retried_payload):
                        public_output = assemble_reconsidered(
                            decision=cadence,
                            context=context,
                            draft_text=draft_text,
                            final_text=retried_payload,
                            message=request.message,
                        )
                        message = final_message(public_output)
                        fact_separation_verified = True
                        memory_raw = retried_payload
                        model = ModelMetadata(
                            provider=model.provider,
                            model=model.model,
                            latency_ms=model.latency_ms + retry_response.metadata.latency_ms,
                            prompt_tokens=_sum_optional(
                                model.prompt_tokens, retry_response.metadata.prompt_tokens
                            ),
                            completion_tokens=_sum_optional(
                                model.completion_tokens, retry_response.metadata.completion_tokens
                            ),
                        )
            else:
                model_response = await self._model_provider.generate(
                    model_request, on_text=_new_relay().on_text
                )
                payload = split_thinking(model_response.content)[1]
                public_output = parse_public_output(
                    raw=payload,
                    decision=cadence,
                    context=context,
                    message=request.message,
                )
                message = final_message(public_output)
                model = model_response.metadata
                memory_raw = payload
                fact_separation_verified = True
            model_memory = (
                parse_memory_candidate(
                    raw=memory_raw,
                    is_correction=perception.is_correction,
                    message=request.message,
                )
                if memory_raw
                else None
            )
            if not thinking_steps and memory_raw:
                # The model nested its thinking lines inside the JSON payload
                # instead of streaming them; recover them for trace and replay.
                thinking_steps.extend(thinking_lines_from_payload(memory_raw))
            reflection = self._reflection.reflect(
                request=request,
                is_correction=perception.is_correction,
                retrieved=context.retrieved_memories,
                model_memory=model_memory,
            )

        trace_id = uuid4()
        response = AgentTurnResponse(
            request_id=request.request_id,
            message=message,
            mode=selection.mode,
            memory_candidates=list(reflection.memory_candidates),
            persona_patch_candidates=list(reflection.persona_patch_candidates),
            relationship_candidates=list(reflection.relationship_candidates),
            cadence=public_output.cadence,
            public_events=public_output.events,
            trace_id=trace_id,
        )
        trace = self._trace(
            request=request,
            trace_id=trace_id,
            selection=selection,
            context=context,
            policy=policy,
            model=model,
            prompt_version=prompt_version,
            response=response,
            cadence=cadence,
            fact_separation_verified=fact_separation_verified,
            thinking_steps=tuple(thinking_steps),
        )
        return RuntimeTurnDetails(
            response=response,
            trace=trace,
            perception=perception,
            selection=selection,
            context=context,
            model=model,
            reflection=reflection,
            cadence=cadence,
            presence=presence,
            fact_separation_verified=fact_separation_verified,
            thinking_steps=tuple(thinking_steps),
        )

    def _trace(
        self,
        *,
        request: AgentTurnRequest,
        trace_id: UUID,
        selection: ModeSelection,
        context: BuiltContext,
        policy: DisclosureResult,
        model: ModelMetadata,
        prompt_version: str,
        response: AgentTurnResponse,
        cadence: CadenceDecision,
        fact_separation_verified: bool,
        thinking_steps: tuple[str, ...] = (),
    ) -> TraceRecord:
        return TraceRecord(
            trace_id=trace_id,
            request_id=request.request_id,
            mode=selection.mode,
            mode_reason=selection.reason,
            policy_decision=policy.decision,
            policy_reason=policy.reason_code,
            prompt_version=prompt_version,
            model_route=model.provider,
            model=model.model,
            latency_ms=model.latency_ms,
            prompt_tokens=model.prompt_tokens,
            completion_tokens=model.completion_tokens,
            persona_version=context.selected_persona.version,
            persona_fields=tuple(context.selected_persona.fields),
            retrieved_memory_ids=tuple(context.summary.memory_ids),
            memory_candidate_count=len(response.memory_candidates),
            persona_candidate_count=len(response.persona_patch_candidates),
            persona_candidate_ids=tuple(item.id for item in response.persona_patch_candidates),
            cadence=cadence.cadence,
            public_event_types=tuple(event.type for event in response.public_events),
            public_evidence_refs=tuple(
                reference
                for event in response.public_events
                if hasattr(event, "evidence_refs")
                for reference in event.evidence_refs
            ),
            fact_separation_verified=fact_separation_verified,
            thinking_steps=thinking_steps,
        )
