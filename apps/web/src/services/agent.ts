import {
  AgentTurnResponseSchema,
  type AgentTurnRequest,
  type AgentTurnResponse,
} from "@reso/contracts";

export async function requestAgentTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
  const response = await fetch("/v1/agent/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) throw new Error("Reso Agent 暂时无法回应");
  return AgentTurnResponseSchema.parse(await response.json());
}
