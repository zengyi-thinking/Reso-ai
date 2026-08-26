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


def parse_public_output(
    *, raw: str, decision: CadenceDecision, context: BuiltContext
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
            raw_events = candidate.get("events", [])
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
        reflection = ConversationCadencePolicy().safe_reflection(decision=decision, context=context)

    messages = [event for event in events if isinstance(event, AgentMessageEvent)][:2]
    if decision.cadence in {ConversationCadence.DIRECT, ConversationCadence.CONSIDERED}:
        messages = [messages[-1]]
        reflection = None
    elif decision.cadence is ConversationCadence.REFLECTIVE:
        messages = [messages[-1]]
    elif not any(message.position == "tentative" for message in messages):
        messages.insert(
            0,
            AgentMessageEvent(
                position="tentative",
                text="我第一反应是想先给你一个明确答案，但这件事好像还不能只看一面。",
            ),
        )
        messages = messages[:2]

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
        return None
    return value if isinstance(value, dict) else None


def _fallback_text(raw: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if cleaned.startswith("{"):
        return "我还在整理这件事。可以把你最在意的那一小段再告诉我一点吗？"
    return cleaned or "我在。你想从哪一小段开始说？"
