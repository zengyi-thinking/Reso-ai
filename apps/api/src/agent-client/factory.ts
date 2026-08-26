import type { IAgentClient } from "./agent-client.js";
import { MockAgentClient } from "./mock-agent-client.js";
import type { MockAgentFailureMode } from "./mock-agent-client.js";
import { ResoAgentClient } from "./reso-agent-client.js";

export type AgentProvider = "mock" | "remote" | "reso-agent";

export function createAgentClient(
  provider: AgentProvider,
  serviceUrl: string,
  options: {
    timeoutMs?: number;
    serviceToken?: string;
    mockFailureMode?: MockAgentFailureMode;
  } = {},
): IAgentClient {
  return provider === "remote" || provider === "reso-agent"
    ? new ResoAgentClient({ baseUrl: serviceUrl, ...options })
    : new MockAgentClient(options.mockFailureMode);
}
