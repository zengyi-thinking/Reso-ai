import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import {
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AnalyzeAssistBodySchema,
  ApiErrorSchema,
  PolishAssistBodySchema,
} from "@reso/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { IAgentClient } from "./agent-client/agent-client.js";
import { SessionService } from "./auth/session-service.js";
import { EmailAuthService } from "./auth/email-auth-service.js";
import type { EmailCodeMailer } from "./auth/email-mailer.js";
import { UnconfiguredEmailCodeMailer } from "./auth/email-mailer.js";
import { InMemoryJourneyRepository } from "./journeys/in-memory-journey-repository.js";
import type { JourneyRepository } from "./journeys/journey-repository.js";
import { JourneyService } from "./journeys/journey-service.js";
import { registerJourneyRoutes, type SessionUserResolver } from "./journeys/routes.js";
import { AssistService } from "./product/assist-service.js";
import { HumanChatService } from "./product/human-chat-service.js";
import { InMemoryProductRepository } from "./product/in-memory-repository.js";
import { ProductError } from "./product/product-error.js";
import { InMemoryWindowRateLimiter, type RateLimiter } from "./product/rate-limiter.js";
import type { ProductRepository } from "./product/repository.js";
import { TeaPartyQueryService } from "./product/tea-party-query-service.js";
import { TeaPartyService } from "./product/tea-party-service.js";
import { InMemoryVerticalSliceRepository } from "./vertical-slice/in-memory-repository.js";
import type { VerticalSliceRepository } from "./vertical-slice/repository.js";
import { OnboardingService } from "./vertical-slice/onboarding-service.js";
import { ProductConversationService } from "./vertical-slice/conversation-service.js";
import { GrowthCandidatesService } from "./vertical-slice/growth-candidates-service.js";
import { registerVerticalSliceRoutes } from "./vertical-slice/routes.js";

const requestTraceIds = new WeakMap<FastifyRequest, string>();

export interface BuildAppOptions {
  agentClient: IAgentClient;
  repository?: ProductRepository;
  journeyRepository?: JourneyRepository;
  rateLimiter?: RateLimiter;
  sessionUserResolver?: SessionUserResolver;
  logger?: boolean;
  verticalSliceRepository?: VerticalSliceRepository;
  emailCodeMailer?: EmailCodeMailer;
  authCodeHashSecret?: string;
  authCodeTtlMs?: number;
  authCodeResendMs?: number;
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
  const repository = options.repository ?? new InMemoryProductRepository();
  const journeyRepository = options.journeyRepository ?? new InMemoryJourneyRepository();
  const journeyService = new JourneyService(journeyRepository);
  const assistService = new AssistService(
    repository,
    options.agentClient,
    options.rateLimiter ?? new InMemoryWindowRateLimiter(),
  );
  const humanChatService = new HumanChatService(repository);
  const teaPartyService = new TeaPartyService(repository, options.agentClient);
  const teaPartyQueryService = new TeaPartyQueryService(repository, teaPartyService);
  const sessionService = new SessionService(repository);
  const verticalSliceRepository =
    options.verticalSliceRepository ?? new InMemoryVerticalSliceRepository();
  const emailAuthService = new EmailAuthService(
    verticalSliceRepository,
    sessionService,
    options.emailCodeMailer ?? new UnconfiguredEmailCodeMailer(),
    {
      hashSecret: options.authCodeHashSecret ?? "reso-development-auth-code-secret",
      ...(options.authCodeTtlMs === undefined ? {} : { ttlMs: options.authCodeTtlMs }),
      ...(options.authCodeResendMs === undefined
        ? {}
        : { resendCooldownMs: options.authCodeResendMs }),
    },
  );
  const onboardingService = new OnboardingService(verticalSliceRepository, options.agentClient);
  const productConversationService = new ProductConversationService(
    verticalSliceRepository,
    options.agentClient,
  );
  const growthCandidatesService = new GrowthCandidatesService(
    verticalSliceRepository,
    options.agentClient,
  );
  const resolveSessionUser = async (request: FastifyRequest): Promise<string | null> => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined && authorization.startsWith("Bearer ")) {
      const userId = await sessionService.resolve(authorization.slice("Bearer ".length).trim());
      if (userId !== null) return userId;
    }
    return options.sessionUserResolver === undefined ? null : options.sessionUserResolver(request);
  };
  await app.register(cors, { origin: false });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .status(404)
      .send(createApiError("route_not_found", "The requested route does not exist.")),
  );

  app.addHook("onRequest", async (request, reply) => {
    const candidate = request.headers["x-trace-id"];
    const traceId =
      typeof candidate === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
        ? candidate
        : randomUUID();
    requestTraceIds.set(request, traceId);
    void reply.header("x-trace-id", traceId);
  });

  app.setErrorHandler((error, request, reply) => {
    const traceId = traceIdFor(request);
    if (error instanceof ProductError) {
      return reply.status(error.httpStatus).send({
        code: error.code,
        message: error.message,
        traceId,
        retryable: error.retryable,
      });
    }
    request.log.error({ err: error, traceId }, "Unhandled Product API error");
    return reply.status(500).send({
      code: "AGENT_UNAVAILABLE",
      message: "Unexpected server error",
      traceId,
      retryable: true,
    });
  });

  app.get("/health", async () => ({ service: "reso-api", status: "ok" }));
  app.get("/v1/health", async () => ({ service: "reso-api", status: "ok" }));
  registerJourneyRoutes(app, {
    journeyService,
    sessionUserResolver: resolveSessionUser,
    traceIdFor,
  });
  registerVerticalSliceRoutes(app, {
    emailAuth: emailAuthService,
    onboarding: onboardingService,
    conversations: productConversationService,
    growth: growthCandidatesService,
    resolveUser: resolveSessionUser,
    traceIdFor,
  });

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

  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/assist/analyze",
    async (request, reply) => {
      const userId = await requireSessionUser(request, resolveSessionUser);
      const parsed = AnalyzeAssistBodySchema.safeParse(request.body);
      if (!parsed.success)
        throw new ProductError("VALIDATION_FAILED", "Invalid analyze request", false);
      const result = await assistService.analyze({
        connectionId: request.params.id,
        requesterUserId: userId,
        messageId: parsed.data.messageId,
        clientRequestId: parsed.data.clientRequestId,
        traceId: traceIdFor(request),
      });
      return reply.send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/assist/polish",
    async (request, reply) => {
      const userId = await requireSessionUser(request, resolveSessionUser);
      const parsed = PolishAssistBodySchema.safeParse(request.body);
      if (!parsed.success)
        throw new ProductError("VALIDATION_FAILED", "Invalid polish request", false);
      const result = await assistService.polish({
        connectionId: request.params.id,
        requesterUserId: userId,
        draft: parsed.data.draft,
        replyToMessageId: parsed.data.replyToMessageId ?? null,
        clientRequestId: parsed.data.clientRequestId,
        traceId: traceIdFor(request),
      });
      return reply.send(result);
    },
  );

  app.get<{ Params: { id: string } }>("/api/assist/:id", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    return reply.send(await assistService.getPrivateResult(request.params.id, userId));
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/messages", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    const body = request.body as { content?: unknown; clientMessageId?: unknown };
    if (
      typeof body?.content !== "string" ||
      body.content.length < 1 ||
      body.content.length > 8_000 ||
      typeof body.clientMessageId !== "string" ||
      body.clientMessageId.length < 1 ||
      body.clientMessageId.length > 200
    ) {
      throw new ProductError("VALIDATION_FAILED", "Invalid human message", false);
    }
    return reply.status(201).send(
      await humanChatService.send({
        connectionId: request.params.id,
        senderUserId: userId,
        content: body.content,
        clientMessageId: body.clientMessageId,
        traceId: traceIdFor(request),
      }),
    );
  });

  app.get<{ Params: { id: string } }>("/api/connections/:id/tea-party", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    return reply.send(await teaPartyQueryService.get(request.params.id, userId));
  });

  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/tea-party/retry",
    async (request, reply) => {
      const userId = await requireSessionUser(request, resolveSessionUser);
      return reply.send(await teaPartyQueryService.retry(request.params.id, userId));
    },
  );

  app.get("/api/notifications", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    return reply.send({ events: await teaPartyQueryService.listNotifications(userId) });
  });

  app.get("/api/notifications/stream", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    const traceId = traceIdFor(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-trace-id": traceId,
    });
    reply.raw.write(`: connected ${traceId}\n\n`);
    const sentEventIds = new Set<string>();
    let closed = false;
    const sendVisibleEvents = async (): Promise<void> => {
      const events = await teaPartyQueryService.listNotifications(userId);
      for (const event of events) {
        if (sentEventIds.has(event.id)) continue;
        sentEventIds.add(event.id);
        reply.raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
    };
    await sendVisibleEvents();
    const interval = setInterval(() => {
      if (closed) return;
      void sendVisibleEvents().catch(() => {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ traceId })}\n\n`);
      });
    }, 2_000);
    reply.raw.once("close", () => {
      closed = true;
      clearInterval(interval);
    });
  });

  app.delete("/api/session", async (request, reply) => {
    const userId = await requireSessionUser(request, resolveSessionUser);
    const authorization = request.headers.authorization;
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      throw new ProductError("AUTH_REQUIRED", "A valid server session is required", false);
    }
    await sessionService.revoke(
      authorization.slice("Bearer ".length).trim(),
      userId,
      traceIdFor(request),
    );
    return reply.status(204).send();
  });

  return app;
}

async function requireSessionUser(
  request: FastifyRequest,
  resolver: BuildAppOptions["sessionUserResolver"],
): Promise<string> {
  const userId = resolver === undefined ? null : await resolver(request);
  if (userId === null)
    throw new ProductError("AUTH_REQUIRED", "A valid server session is required", false);
  return userId;
}

function traceIdFor(request: FastifyRequest): string {
  const existing = requestTraceIds.get(request);
  if (existing !== undefined) return existing;
  const generated = randomUUID();
  requestTraceIds.set(request, generated);
  return generated;
}
