import type { EventEnvelope } from "@reso/contracts";
import type { ReflectionOrchestrationService } from "@reso/api/vertical-slice/reflection-service";

export async function scheduleReflection(
  event: EventEnvelope,
  service: ReflectionOrchestrationService,
): Promise<boolean> {
  return service.handleUserMessageCreated(event);
}
