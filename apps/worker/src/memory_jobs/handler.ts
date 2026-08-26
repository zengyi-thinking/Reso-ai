import type { EventEnvelope, MemoryCandidate } from "@reso/contracts";

export async function proposeMemory(event: EventEnvelope): Promise<MemoryCandidate[]> {
  if (event.type !== "message.created") return [];
  return Promise.resolve([]);
}
