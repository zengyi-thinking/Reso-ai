from __future__ import annotations

import json
import re

from pydantic import ValidationError

from reso_agent.context.builder import BuiltContext
from reso_agent.contracts import (
    AgentMessageEvent,
    AgentPublicEvent,
    AgentPublicOutput,
    AgentPublicReflectionEvent,
    ConversationCadence,
    MemoryCandidate,
    MemoryType,
)
from reso_agent.runtime.cadence import CadenceDecision, ConversationCadencePolicy

_UNCERTAINTY_MARKERS = ("猜", "可能", "不确定", "会不会", "像你吗")


def public_output_contract(decision: CadenceDecision, context: BuiltContext) -> str:
    evidence: list[dict[str, str]] = [{"ref": "message:current", "kind": "current_message"}]
    evidence.extend(
        {
            "ref": f"memory:{index}",
            "kind": item.memory.type.value,
            "summary": item.memory.summary,
        }
        for index, item in enumerate(context.retrieved_memories)
        if item.score.final >= 0.45
    )
    evidence.extend(
        {"ref": f"persona:{index}", "kind": "persona", "summary": value}
        for index, value in enumerate(context.selected_persona.fields)
    )
    return json.dumps(
        {
            "cadence": decision.cadence.value,
            "allowedEvidence": evidence,
            "memory": {
                "type": "episodic|persona_related|relationship|correction",
                "summary": (
                    "用你自己的观察记下这轮值得记住的事：保留关键细节"
                    "（对象、事件、情绪底色），写成你的理解而不是复述或改写"
                    "用户原话；禁止'用户分享了经历'一类空泛模板，≤60字"
                ),
                "confidence": 0.8,
            },
            "output": {
                "events": [
                    {
                        "type": "public_reflection",
                        "text": "only when cadence is reflective/reconsidered",
                        "evidenceRefs": ["one allowed ref"],
                    },
                    {
                        "type": "message",
                        "position": "tentative|continuation|final",
                        "text": "user-facing text",
                    },
                ]
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


_MEMORY_TYPES = {"episodic", "persona_related", "relationship", "correction", "reflection"}
_THINKING_LINE_LIMIT = 3
_THINKING_TEXT_CAP = 40


def split_thinking(content: str) -> tuple[list[str], str]:
    """Split model output into public thinking lines ("> …") and the JSON payload.

    Thinking lines are designed public process notes the model writes before the
    JSON object; they are streamed live, never contain hidden reasoning, and are
    dropped from the payload before parsing. Stray non-marker lines before the
    JSON are ignored rather than glued into the payload.
    """
    lines: list[str] = []
    payload_lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if payload_lines:
            # A stray "> …" line after the JSON began never joins the payload.
            if not stripped.startswith(">"):
                payload_lines.append(line)
            continue
        if stripped.startswith(">"):
            text = stripped.lstrip(">").strip()
            if text and len(lines) < _THINKING_LINE_LIMIT:
                lines.append(text[:_THINKING_TEXT_CAP])
            continue
        if stripped.startswith("{") or stripped.startswith("```"):
            payload_lines.append(line)
    if not payload_lines:
        return lines, content.strip()
    return lines, "\n".join(payload_lines).strip()


def parse_memory_candidate(
    *, raw: str, is_correction: bool, message: str = ""
) -> MemoryCandidate | None:
    """Extract the model-written memory for this turn from the same JSON payload.

    The model records its own observation of what happened, so stored memories
    stay specific without parroting the user. A summary that merely restates the
    message is rejected and falls back to the deterministic extractor.
    """
    candidate = _json_object(raw)
    if not isinstance(candidate, dict):
        return None
    raw_memory = candidate.get("memory")
    if not isinstance(raw_memory, dict):
        return None
    summary = str(raw_memory.get("summary") or "").strip()
    if not summary or len(summary) > 120 or summary.startswith("用户分享"):
        return None
    if message and _restates(summary, message):
        return None
    memory_type = str(raw_memory.get("type") or "").strip()
    if memory_type not in _MEMORY_TYPES:
        memory_type = "episodic"
    if is_correction:
        memory_type = "correction"
    try:
        confidence = max(0.0, min(1.0, float(raw_memory.get("confidence", 0.7))))
    except (TypeError, ValueError):
        confidence = 0.7
    return MemoryCandidate(
        type=MemoryType(memory_type),
        summary=summary,
        evidence_message_ids=[],
        confidence=confidence,
        requires_review=is_correction,
    )


_PUNCTUATION = re.compile(r"[\s，。！？；：、,.!?;:'\"（）()「」…\-—]+")


def _restates(summary: str, message: str) -> bool:
    """True when the summary is essentially the message repeated back."""
    compact = _PUNCTUATION.sub("", summary)
    source = _PUNCTUATION.sub("", message)
    if len(compact) < 8 or len(source) < 8:
        return False
    return compact in source or source in compact


def parse_public_output(
    *, raw: str, decision: CadenceDecision, context: BuiltContext, message: str = ""
) -> AgentPublicOutput:
    allowed_refs = {"message:current"}
    allowed_refs.update(
        f"memory:{index}"
        for index, item in enumerate(context.retrieved_memories)
        if item.score.final >= 0.45
    )
    allowed_refs.update(
        f"persona:{index}" for index, _ in enumerate(context.selected_persona.fields)
    )

    candidate = _json_object(raw)
    events: list[AgentPublicEvent] = []
    if candidate is not None:
        try:
            # Models either return a bare {events:[...]} or echo the contract
            # template with events nested under "output"; accept both shapes.
            raw_events = candidate.get("events")
            if not isinstance(raw_events, list):
                nested = candidate.get("output")
                raw_events = nested.get("events", []) if isinstance(nested, dict) else []
            if not isinstance(raw_events, list):
                raw_events = []
            for raw_event in raw_events:
                if not isinstance(raw_event, dict):
                    continue
                event_type = raw_event.get("type")
                if event_type == "public_reflection":
                    parsed_reflection = AgentPublicReflectionEvent.model_validate(raw_event)
                    if set(parsed_reflection.evidence_refs).issubset(allowed_refs):
                        events.append(parsed_reflection)
                elif event_type == "message":
                    events.append(AgentMessageEvent.model_validate(raw_event))
        except (AttributeError, TypeError, ValidationError):
            events = []

    final_messages = [
        event
        for event in events
        if isinstance(event, AgentMessageEvent) and event.position == "final"
    ]
    if not final_messages:
        events = [AgentMessageEvent(position="final", text=_fallback_text(raw))]

    reflection: AgentPublicReflectionEvent | None = next(
        (event for event in events if isinstance(event, AgentPublicReflectionEvent)), None
    )
    if reflection is None:
        reflection = ConversationCadencePolicy().safe_reflection(
            decision=decision, context=context, message=message
        )

    messages = [event for event in events if isinstance(event, AgentMessageEvent)][:2]
    if decision.cadence in {ConversationCadence.DIRECT, ConversationCadence.CONSIDERED}:
        messages = [messages[-1]]
        reflection = None
    elif decision.cadence is ConversationCadence.REFLECTIVE:
        messages = [messages[-1]]

    if (
        reflection
        and reflection.evidence_refs == ["message:current"]
        and not any(marker in reflection.text for marker in _UNCERTAINTY_MARKERS)
    ):
        reflection = reflection.model_copy(update={"text": f"我不太确定，但{reflection.text}"})

    ordered: list[AgentPublicEvent] = []
    statuses = list(decision.status_events)
    if decision.cadence is ConversationCadence.RECONSIDERED:
        if statuses:
            ordered.append(statuses[0])
        if reflection:
            ordered.append(reflection)
        ordered.append(messages[0])
        if len(statuses) > 1:
            ordered.append(statuses[1])
        ordered.append(messages[-1].model_copy(update={"position": "final"}))
    else:
        ordered.extend(statuses[:1])
        if reflection:
            ordered.append(reflection)
        ordered.append(messages[-1].model_copy(update={"position": "final"}))

    return AgentPublicOutput(cadence=decision.cadence, events=ordered[:5])


def assemble_reconsidered(
    *,
    decision: CadenceDecision,
    context: BuiltContext,
    draft_text: str,
    final_text: str,
    message: str = "",
) -> AgentPublicOutput:
    """Assemble the public sequence for a genuine two-pass re-consideration.

    The tentative message and the final message come from two separate model
    calls, so the visible "let me think again" reflects real re-examination.
    """
    reflection = ConversationCadencePolicy().safe_reflection(
        decision=decision, context=context, message=message
    )
    statuses = list(decision.status_events)
    events: list[AgentPublicEvent] = []
    if statuses:
        events.append(statuses[0])
    if reflection is not None:
        events.append(reflection)
    events.append(AgentMessageEvent(position="tentative", text=draft_text.strip()))
    if len(statuses) > 1:
        events.append(statuses[1])
    events.append(AgentMessageEvent(position="final", text=final_text.strip()))
    return AgentPublicOutput(cadence=ConversationCadence.RECONSIDERED, events=events[:5])


def final_message(output: AgentPublicOutput) -> str:
    final = next(
        event
        for event in reversed(output.events)
        if isinstance(event, AgentMessageEvent) and event.position == "final"
    )
    return final.text


def _json_object(raw: str) -> dict[str, object] | None:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        # Models sometimes append prose after a fenced JSON block; fall back to
        # the outermost brace span so one trailing sentence cannot sink the turn.
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def thinking_lines_from_payload(raw: str) -> list[str]:
    """Recover thinking lines the model nested inside the JSON payload.

    The contract asks for "> …" lines before the JSON so they stream live, but
    models often nest them as a `thinkingLines` array instead. Recovered lines
    are persisted for the trace and replay even though they did not stream.
    """
    candidate = _json_object(raw)
    if not isinstance(candidate, dict):
        return []
    nested_output = candidate.get("output")
    sources = [candidate, nested_output if isinstance(nested_output, dict) else {}]
    nested: object = None
    for source in sources:
        for key in ("thinkingLines", "thinking_lines"):
            value = source.get(key)
            if isinstance(value, list) and value:
                nested = value
                break
        if nested is not None:
            break
    if not isinstance(nested, list):
        return []
    lines: list[str] = []
    for item in nested:
        text = str(item).strip().lstrip(">").strip()
        if text:
            lines.append(text[:_THINKING_TEXT_CAP])
        if len(lines) >= _THINKING_LINE_LIMIT:
            break
    return lines


def _fallback_text(raw: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if cleaned.startswith("{"):
        return "我还在整理这件事。可以把你最在意的那一小段再告诉我一点吗？"
    return cleaned or "我在。你想从哪一小段开始说？"
