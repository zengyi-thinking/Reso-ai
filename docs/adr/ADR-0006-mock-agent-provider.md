# ADR-0006: Mock Agent Provider

**Status:** Accepted  
**Date:** 2026-08-26

## Decision

API 通过 `IAgentClient` 选择 `MockAgentClient` 或 `ResoAgentClient`。本地/CI 默认 Mock；两者返回相同 Contract。生产真实 provider 失败时禁止 silent fallback。

## Consequences

Frontend/Backend 不等待 Agent，也不依赖付费模型；必须用契约测试持续防止 Mock 漂移或过度理想化。
