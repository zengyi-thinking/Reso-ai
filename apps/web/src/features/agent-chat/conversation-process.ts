import type { AgentPublicEvent } from "@reso/contracts";

export type ProcessEvent = Exclude<AgentPublicEvent, { type: "message"; position: "final" }>;

export function buildProcessSteps(events: AgentPublicEvent[]): ProcessEvent[] {
  return events.filter(
    (event): event is ProcessEvent => event.type !== "message" || event.position !== "final",
  );
}

export function processSummary(events: AgentPublicEvent[]): string {
  const steps = buildProcessSteps(events);
  const deep = steps.some((event) => event.type === "status" && event.label === "先找一个具体共鸣");
  return `${deep ? "深度关系思考 · " : "想了 "}${steps.length} 步`;
}
