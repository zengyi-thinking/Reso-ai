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
    PublicProcessMode,
)
from reso_agent.memory.retriever import MemoryRetriever
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
from reso_agent.runtime.language import quote_terms
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
from reso_agent.tools.deep_recall import _TOOL_NAME, MemoryDeepRecallTool
from reso_agent.tools.registry import ToolRegistry
from reso_agent.tracing.trace import TraceRecord

_PROMPT_ROOT = Path(__file__).parents[1] / "prompts"

_THINKING_STEP_CAP = 5

_RELATIONSHIP_PROCESS_LABELS = (
    "先找一个具体共鸣",
    "再看看边界",
    "比较相处的节奏",
    "最后预演一下难处",
)
_RELATIONSHIP_PROCESS_PREFIXES = ("共鸣：", "边界：", "节奏：", "预演：")
_RELATIONSHIP_STEP_MARKERS = (
    ("具体", "偏好", "共鸣", "好奇", "还", "没", "不够", "靠近"),
    ("边界", "不能", "不该", "别", "不", "缺", "还没", "勉强"),
    ("节奏", "沟通", "压力", "空间", "快", "慢", "支持", "靠近"),
    ("冲突", "卡住", "预演", "不了解", "还没", "不足", "暂时", "先不"),
)


def _thinking_event(text: str, step: int, mode: PublicProcessMode) -> AgentStatusEvent:
    label = (
        _RELATIONSHIP_PROCESS_LABELS[step - 1]
        if mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE
        and step <= len(_RELATIONSHIP_PROCESS_LABELS)
        else None
    )
    return AgentStatusEvent(
        phase=AgentStatusPhase.COMPOSING,
        step=step,
        label=label,
        text=text,
    )


def _deep_process_fallback(message: str, context: BuiltContext) -> tuple[str, ...]:
    anchor = quote_terms(message, limit=1) or "你在意的这件事"
    has_boundaries = bool(context.selected_persona.fields.get("boundaries"))
    has_rhythm = bool(
        context.selected_persona.fields.get("social_style")
        or context.selected_persona.fields.get("communication_style")
    )
    has_relationship = context.summary.relationship_included
    return (
        f"先从{anchor}里找一个真实的靠近点",
        "翻一下已确认的边界" if has_boundaries else "边界信息还不够，先不替你判断",
        "对照你习惯的相处节奏" if has_rhythm else "相处节奏还需要再认识",
        "只预想一个可能卡住的地方" if has_relationship else "还不了解对方，暂时不做冲突预演",
    )


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
        process_mode: PublicProcessMode,
        fallback_steps: tuple[str, ...] = (),
    ) -> None:
        self._on_progress = on_progress
        self._steps = steps
        self._process_mode = process_mode
        self._fallback_steps = fallback_steps
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
        cap = (
            len(_RELATIONSHIP_PROCESS_LABELS)
            if self._process_mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE
            else _THINKING_STEP_CAP
        )
        if len(self._steps) >= cap:
            return
        text = stripped.lstrip(">").strip()[:40]
        if self._process_mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE:
            expected = _RELATIONSHIP_PROCESS_PREFIXES[len(self._steps)]
            if not text.startswith(expected):
                return
            text = text.removeprefix(expected).strip()
            step_index = len(self._steps)
            if not any(marker in text for marker in _RELATIONSHIP_STEP_MARKERS[step_index]):
                text = self._fallback_steps[step_index]
        if not text:
            return
        self._steps.append(text)
        if self._on_progress is not None:
            self._on_progress(_thinking_event(text, len(self._steps), self._process_mode))


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
        deep_recall: MemoryDeepRecallTool | None = None,
    ) -> None:
        self._model_provider = model_provider or create_real_provider_from_env()
        self._policy = policy or DisclosurePolicy()
        self._mode_router = mode_router or ModeRouter()
        self._context_builder = context_builder or ContextBuilder()
        self._reflection = reflection or ReflectionService()
        self._cadence_policy = cadence_policy or ConversationCadencePolicy()
        self._presence_builder = presence_builder or PresenceBuilder()
        self._tool_registry = ToolRegistry()
        self._tool_registry.register(deep_recall or MemoryDeepRecallTool(MemoryRetriever()))

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
        # One lazy query embedding per turn, only when stored memory vectors
        # exist to blend against; otherwise the free lexical baseline runs alone.
        query_embedding = await self._semantic_query_vector(
            message=request.message, authorized=authorized
        )
        context = self._context_builder.build(
            message=request.message,
            authorized=authorized,
            query_embedding=query_embedding,
        )
        cadence = self._cadence_policy.decide(
            message=request.message,
            perception=perception,
            selection=selection,
            context=context,
            recent_cadences=recent_cadences,
            recent_public_memory_ids=recent_public_memory_ids,
        )
        if (
            on_progress is not None
            and cadence.status_events
            and request.public_process_mode is PublicProcessMode.ADAPTIVE
        ):
            on_progress(cadence.status_events[0])
        policy = self._policy.decide(
            proxy_requested=selection.mode is AgentMode.PROXY,
            active_consent=authorized.active_proxy_consent,
        )
        executed_tools: tuple[str, ...] = ()
        if policy.decision is not PolicyDecision.ASK_USER:
            context, executed_tools = self._apply_deep_recall(
                message=request.message, authorized=authorized, context=context
            )
            if (
                on_progress is not None
                and executed_tools
                and request.public_process_mode is PublicProcessMode.ADAPTIVE
            ):
                on_progress(
                    AgentStatusEvent(
                        phase=AgentStatusPhase.RECALLING, text="又翻了几条之前的记忆。"
                    )
                )
        presence = self._presence_builder.build(
            relationship=authorized.relationship,
            memories=authorized.memories,
            recent_messages=authorized.recent_messages,
        )
        if selection.mode is AgentMode.PROXY:
            version = "v1"
        elif selection.mode is AgentMode.COMPANION:
            version = "v4"
        else:
            version = "v3"
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
            if request.public_process_mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE:
                base_system_prompt += (
                    "\n\n[Optional Deep Relationship Public Process]\n"
                    "Write exactly four public thinking lines before the JSON. Keep "
                    "them plain, warm and specific to the authorized evidence in this "
                    "turn. In order: (1) identify one concrete micro-preference or "
                    "point of curiosity; (2) check explicit boundaries, incompatible "
                    "directions or likely harm; (3) compare support styles and stress "
                    "rhythms without diagnosing either person; (4) only if evidence "
                    "allows, name one possible friction scenario and what remains "
                    "uncertain. If evidence is missing, say what cannot yet be checked. "
                    "Do not claim that a simulation, search or memory retrieval happened "
                    "unless the supplied context proves it. Use these exact prefixes "
                    'and order: "> 共鸣：…", "> 边界：…", "> 节奏：…", '
                    '"> 预演：…". The text after each prefix must perform that named '
                    "check; do not replace it with a general observation or a claim "
                    "that something was recorded."
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
                fallback = (
                    _deep_process_fallback(request.message, context)
                    if request.public_process_mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE
                    else ()
                )
                return _ThinkingRelay(
                    on_progress,
                    thinking_steps,
                    request.public_process_mode,
                    fallback,
                )

            # Cadences that persist no status (direct) still show one live
            # composing signal so the user never stares at a frozen thread.
            if (
                on_progress is not None
                and not cadence.status_events
                and request.public_process_mode is PublicProcessMode.ADAPTIVE
            ):
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
                if (
                    on_progress is not None
                    and len(cadence.status_events) > 1
                    and request.public_process_mode is PublicProcessMode.ADAPTIVE
                ):
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
                if on_progress is not None:
                    for index, text in enumerate(thinking_steps, start=1):
                        on_progress(_thinking_event(text, index, request.public_process_mode))
            if request.public_process_mode is PublicProcessMode.RELATIONSHIP_DEEP_DIVE and len(
                thinking_steps
            ) < len(_RELATIONSHIP_PROCESS_LABELS):
                fallback = _deep_process_fallback(request.message, context)
                start = len(thinking_steps)
                thinking_steps.extend(fallback[start:])
                if on_progress is not None:
                    for index in range(start, len(thinking_steps)):
                        on_progress(
                            _thinking_event(
                                thinking_steps[index], index + 1, request.public_process_mode
                            )
                        )
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
            tool_names=executed_tools,
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

    async def _semantic_query_vector(
        self, *, message: str, authorized: AgentAuthorizedContext
    ) -> list[float] | None:
        if not any(memory.embedding for memory in authorized.memories):
            return None
        vectors = await self._model_provider.embed([message])
        return list(vectors[0]) if vectors else None

    def _apply_deep_recall(self, *, message: str, authorized: AgentAuthorizedContext, context):
        """Run the allowlisted deep-recall tool when triggered and merge any
        additional memories into the built context (appended, so public evidence
        indexes stay stable). Returns the possibly-updated context plus the
        names of tools that actually fired for the trace allowlist."""
        tool = self._tool_registry.get(_TOOL_NAME)
        if tool is None:
            return context, ()
        result = tool.run(message=message, memories=list(authorized.memories))
        if result.detail == "not-triggered":
            return context, ()
        extras = tuple(result.data)
        if not extras:
            return context, (result.name,)
        merged_ids = list(context.summary.memory_ids) + [item.memory.id for item in extras]
        merged_context = replace(
            context,
            retrieved_memories=context.retrieved_memories + extras,
            system_context=(
                f"{context.system_context}\n\n[Recalled via {result.name}]\n"
                + "\n".join(f"- {item.memory.summary}" for item in extras)
            ),
            summary=context.summary.model_copy(update={"memory_ids": merged_ids}),
        )
        return merged_context, (result.name,)

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
        tool_names: tuple[str, ...] = (),
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
            tool_names=tool_names,
        )
