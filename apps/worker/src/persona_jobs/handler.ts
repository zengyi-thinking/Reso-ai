import { JourneyCompletedEventSchema, type EventEnvelope } from "@reso/contracts";

export interface PersonalManualGenerator {
  generate(journeyId: string, traceId: string): Promise<unknown>;
}

export async function handlePersonaCandidate(event: EventEnvelope): Promise<boolean> {
  return Promise.resolve(event.type === "persona.updated");
}

export async function handleJourneyCompleted(
  event: EventEnvelope,
  generator: PersonalManualGenerator,
): Promise<boolean> {
  if (event.type !== "journey.completed") return false;
  const completedEvent = JourneyCompletedEventSchema.safeParse(event);
  if (!completedEvent.success) {
    throw new NonRetryablePersonaJobError("INVALID_JOURNEY_COMPLETED_EVENT");
  }
  await generator.generate(completedEvent.data.payload.journeyId, event.correlationId);
  return true;
}

export class NonRetryablePersonaJobError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "NonRetryablePersonaJobError";
  }
}
