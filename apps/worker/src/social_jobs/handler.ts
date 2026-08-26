import type { EventEnvelope } from "@reso/contracts";

export async function handleSocialMission(event: EventEnvelope): Promise<boolean> {
  return Promise.resolve(event.type === "social_mission.created");
}
