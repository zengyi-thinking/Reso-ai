import cors from "@fastify/cors";
import { AgentTurnRequestSchema, AgentTurnResponseSchema } from "@reso/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import type { IAgentClient } from "./agent-client/agent-client.js";

export interface BuildAppOptions {
  agentClient: IAgentClient;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({ service: "reso-api", status: "ok" }));
  app.get("/v1/health", async () => ({ service: "reso-api", status: "ok" }));

  app.post("/v1/agent/turn", async (request, reply) => {
    const parsed = AgentTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        details: parsed.error.issues,
      });
    }

    const result = AgentTurnResponseSchema.parse(await options.agentClient.turn(parsed.data));
    return reply.send(result);
  });

  return app;
}
