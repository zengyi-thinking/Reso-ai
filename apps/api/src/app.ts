import cors from "@fastify/cors";
import { AgentTurnRequestSchema, AgentTurnResponseSchema, ApiErrorSchema } from "@reso/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import type { IAgentClient } from "./agent-client/agent-client.js";

export interface BuildAppOptions {
  agentClient: IAgentClient;
  logger?: boolean;
}

function createApiError(
  code: string,
  message: string,
  details?: Array<{ path: string; message: string }>,
) {
  return ApiErrorSchema.parse({ error: { code, message, details } });
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: false });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .status(404)
      .send(createApiError("route_not_found", "The requested route does not exist.")),
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "Unhandled Product API error");
    const reportedStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const status = reportedStatus >= 400 && reportedStatus < 500 ? reportedStatus : 500;
    const code = status === 500 ? "internal_error" : "request_failed";
    const message =
      status === 500
        ? "The Product API could not complete the request."
        : error instanceof Error
          ? error.message
          : "The request could not be completed.";
    return reply.status(status).send(createApiError(code, message));
  });

  app.get("/health", async () => ({ service: "reso-api", status: "ok" }));
  app.get("/v1/health", async () => ({ service: "reso-api", status: "ok" }));

  app.post("/v1/agent/turn", async (request, reply) => {
    const parsed = AgentTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        createApiError(
          "invalid_request",
          "Request does not match AgentTurnRequest.",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
    }

    try {
      const result = AgentTurnResponseSchema.parse(await options.agentClient.turn(parsed.data));
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error({ error }, "Agent provider rejected the turn");
      return reply
        .status(502)
        .send(
          createApiError("agent_provider_failed", "The Agent provider returned no valid result."),
        );
    }
  });

  return app;
}
