import type { IAgentClient } from "./agent-client.js";
import { MockAgentClient } from "./mock-agent-client.js";
import { ResoAgentClient } from "./reso-agent-client.js";

export type AgentProvider = "mock" | "reso-agent";

export function createAgentClient(provider: AgentProvider, serviceUrl: string): IAgentClient {
  return provider === "reso-agent" ? new ResoAgentClient(serviceUrl) : new MockAgentClient();
}
