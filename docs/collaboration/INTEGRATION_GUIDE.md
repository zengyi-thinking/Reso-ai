# Integration Guide

## Frontend ↔ Backend

Web 从 `@reso/contracts` 导入类型/schema，通过 Product API 请求。开发中可使用 Fastify inject 测试或稳定 fixture，禁止直接 import API 内部实现。

## Backend ↔ Agent

只在 composition root 创建 `ResoAgentClient`（唯一实现）。远端结果必须 parse；真实 provider 失败直接显式暴露，不 silent fallback。测试使用测试文件内的内联 stub，产品代码不提供 Mock。

## TypeScript ↔ Python

当前用 Zod 与 Pydantic 对齐 JSON aliases。新增/修改字段时：先改 Contracts → 更新 golden fixture → 更新 Python model/OpenAPI → 运行双方测试。Stage 1 应自动比较 JSON Schema/OpenAPI。

## Events

Product transaction 写业务状态与 outbox；publisher 投递 Redis Streams；Worker 使用 event id 做幂等；Worker 提交 Candidate 时再次验证状态/version。当前仅有 handler 骨架，不应被误认为可靠队列已实现。
