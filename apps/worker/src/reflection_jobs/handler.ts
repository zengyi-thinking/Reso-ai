import type { EventEnvelope } from "@reso/contracts";

export async function scheduleReflection(event: EventEnvelope): Promise<boolean> {
  return Promise.resolve(event.type === "message.created");
}
