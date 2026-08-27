import type { EventEnvelope } from "@reso/contracts";

export interface TeaPartyJobRunner {
  onRelationshipEstablished(connectionId: string, traceId: string): Promise<unknown>;
  run(connectionId: string): Promise<unknown>;
  stopForConsentRevocation(connectionId: string, userId: string): Promise<void>;
  stopForBlock(connectionId: string, blockerUserId: string): Promise<void>;
}

export async function handleSocialMission(
  event: EventEnvelope,
  runner?: TeaPartyJobRunner,
): Promise<boolean> {
  if (runner === undefined) return Promise.resolve(event.type === "social_mission.created");
  const connectionId = event.payload.connectionId;
  if (typeof connectionId !== "string") return false;
  if (event.type === "connection.established" || event.type === "consent.granted") {
    await runner.onRelationshipEstablished(connectionId, event.correlationId);
    return true;
  }
  if (event.type === "social_mission.created") {
    await runner.run(connectionId);
    return true;
  }
  if (event.type === "consent.revoked") {
    const userId = event.payload.userId;
    if (typeof userId !== "string") return false;
    await runner.stopForConsentRevocation(connectionId, userId);
    return true;
  }
  if (event.type === "connection.blocked") {
    const blockerUserId = event.payload.blockerUserId;
    if (typeof blockerUserId !== "string") return false;
    await runner.stopForBlock(connectionId, blockerUserId);
    return true;
  }
  return false;
}
