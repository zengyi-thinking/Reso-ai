# ADR-0002: Agent Service Boundary

**Status:** Accepted  
**Date:** 2026-08-26

## Decision

Reso Agent 使用独立 Python/FastAPI 服务，负责智能运行时、Policy、Tools、Model routing、Trace 与 Eval。Product API 拥有正式事实；Agent 不写 Product DB，只返回 Candidate。

## Consequences

模型迭代与产品状态解耦，隐私/授权边界更清晰；需要维护跨语言 Contract parity 和网络失败策略。
