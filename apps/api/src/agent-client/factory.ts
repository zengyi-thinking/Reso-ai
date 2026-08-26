import type { IAgentClient } from "./agent-client.js";
import { ResoAgentClient } from "./reso-agent-client.js";

export function createAgentClient(serviceUrl: string): IAgentClient {
  return new ResoAgentClient(serviceUrl);
}
