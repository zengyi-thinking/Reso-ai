# Integration Guide

## Frontend ↔ Backend

Web 从 `@reso/contracts` 导入类型/schema，通过 Product API 请求。开发中可使用 Fastify inject 测试或稳定 fixture，禁止直接 import API 内部实现。

## Backend ↔ Agent

只在 composition root 创建 `ResoAgentClient`（唯一实现）。远端结果必须 parse；真实 provider 失败直接显式暴露，不 silent fallback。测试使用测试文件内的内联 stub，产品代码不提供 Mock。

## Post-connection Tea Party

Tea Party 只在真人 Connection 已建立且双方 Proxy Consent 有效后创建。Backend 通过 Outbox 产生 `social_mission.created`，Worker 通过 `TeaPartyJobRunner` 执行有限轮任务。Frontend 只查询 Product API，不调用 Agent Service。

本地默认使用 Mock；真实联调设置 `AGENT_PROVIDER=remote`、`AGENT_SERVICE_URL`、`AGENT_SERVICE_TOKEN` 和 `AGENT_TIMEOUT_MS`。真实服务必须先通过 Assist/Social Act/Social Evaluate Contract Test，不能把不合法响应写入数据库。

Product API 支持轮询 `/api/notifications` 和 SSE `/api/notifications/stream`。SSE 只发送事件类型、Connection ID、时间和 Trace；Frontend 收到 `tea_party.ready` 后再调用 Tea Party GET 接口读取有权限保护的正文。断线时轮询仍可兜底。

当前 Agent Service 的 Python Contract 仍是旧版 `AgentTurnRequest/SocialMissionResult`，与 Backend 的 Assist Task 和单轮 Social Act Contract 不一致。必须由 Tech Lead 冻结共享 Contract、Agent 团队更新 Pydantic/OpenAPI 后，才能进行真实 Agent 联调；Backend 不应越界修改 Agent Runtime 或 Prompt。

## TypeScript ↔ Python

当前用 Zod 与 Pydantic 对齐 JSON aliases。新增/修改字段时：先改 Contracts → 更新 golden fixture → 更新 Python model/OpenAPI → 运行双方测试。Stage 1 应自动比较 JSON Schema/OpenAPI。

## Events

Product transaction 写业务状态与 PostgreSQL Outbox；Worker 使用 `FOR UPDATE SKIP LOCKED` 领取事件，支持锁超时恢复、指数退避、最多 5 次处理和 event id 幂等。Social Mission 和每轮 Interaction 仍由数据库唯一约束提供第二层幂等保护。V0.1 不依赖 Redis Streams；Redis 保留给后续缓存或明确需要的实时基础设施。
