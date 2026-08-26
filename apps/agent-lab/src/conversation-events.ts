import type { AgentPublicEvent } from "@reso/contracts";

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

export function eventPauseDuration(event: AgentPublicEvent): number {
  if (event.type === "public_reflection") return 320;
  if (event.type === "message" && event.position !== "final") return 260;
  if (event.type === "status" && event.phase === "reconsidering") return 180;
  return 0;
}
