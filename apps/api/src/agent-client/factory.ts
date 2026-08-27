import type { IAgentClient } from "./agent-client.js";
import { ResoAgentClient } from "./reso-agent-client.js";

export function createAgentClient(
  serviceUrl: string,
  options: {
    timeoutMs?: number;
    serviceToken?: string;
  } = {},
): IAgentClient {
  return new ResoAgentClient({ baseUrl: serviceUrl, ...options });
}
