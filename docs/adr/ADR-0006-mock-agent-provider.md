# ADR-0006: Mock Agent Provider（已废弃）

**Status:** Superseded
**Date:** 2026-08-26

## Decision

该早期方案已废弃。Product API 在所有运行环境中只装配 `ResoAgentClient`；配置缺失或真实 Agent 调用失败时显式报错，禁止切换或回退到替代模型。

## Consequences

CI 使用测试目录内的确定性 `TestAgentClient` 测试桩验证 Backend 编排；它不是可配置模型，也不会进入构建产物或产品运行路径。真实联调必须调用 MiniMax 驱动的 Agent Service。
