import type { AgentPublicEvent, AgentStreamEvent } from "@reso/contracts";

export type PendingEventState = {
  events: AgentPublicEvent[];
  streaming: string | null;
};

export function initialPendingState(): PendingEventState {
  return { events: [], streaming: null };
}

export function applyStreamEvent(
  state: PendingEventState,
  event: AgentStreamEvent,
): PendingEventState {
  if (event.type === "message_delta") {
    return { ...state, streaming: (state.streaming ?? "") + event.text };
  }
  if (event.type === "complete" || event.type === "error") {
    return state;
  }
  return {
    streaming: null,
    events: nextVisibleEvents(state.events, event),
  };
}

export function nextVisibleEvents(
  current: AgentPublicEvent[],
  event: AgentPublicEvent,
): AgentPublicEvent[] {
  if (event.type === "status" && event.phase !== "reconsidering") {
    return [
      ...current.filter((item) => item.type !== "status" || item.phase === "reconsidering"),
      event,
    ];
  }
  if (event.type !== "status") {
    return [
      ...current.filter((item) => item.type !== "status" || item.phase === "reconsidering"),
      event,
    ];
  }
  return [...current, event];
}

export function eventPauseDuration(event: AgentStreamEvent): number {
  if (event.type === "message_delta") return 0;
  if (event.type === "public_reflection") return 520;
  if (event.type === "message" && event.position !== "final") return 200;
  if (event.type === "status" && event.phase === "reconsidering") return 420;
  if (event.type === "status") return 200;
  if (event.type === "message") return 160;
  return 0;
}
