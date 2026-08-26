import type { AssistStatus, TeaPartyStatus } from "@reso/contracts";

const assistTransitions: Readonly<Record<AssistStatus, readonly AssistStatus[]>> = {
  queued: ["running", "failed"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["queued"],
};

const teaPartyTransitions: Readonly<Record<TeaPartyStatus, readonly TeaPartyStatus[]>> = {
  not_available: [],
  permission_required: [],
  queued: ["running", "cancelled", "blocked", "failed"],
  running: ["ready", "failed", "cancelled", "blocked"],
  ready: [],
  failed: ["queued", "cancelled", "blocked"],
  blocked: [],
  cancelled: [],
};

export function assertAssistTransition(from: AssistStatus, to: AssistStatus): void {
  if (!assistTransitions[from].includes(to))
    throw new Error(`Invalid Assist transition: ${from} -> ${to}`);
}

export function assertTeaPartyTransition(from: TeaPartyStatus, to: TeaPartyStatus): void {
  if (!teaPartyTransitions[from].includes(to)) {
    throw new Error(`Invalid Tea Party transition: ${from} -> ${to}`);
  }
}
