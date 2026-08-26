import type { EventEnvelope } from "@reso/contracts";

export async function handlePersonaCandidate(event: EventEnvelope): Promise<boolean> {
  return Promise.resolve(event.type === "persona.updated");
}
