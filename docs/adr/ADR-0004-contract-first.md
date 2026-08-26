# ADR-0004: Contract First

**Status:** Accepted  
**Date:** 2026-08-26

## Decision

所有跨团队 HTTP/事件边界先定义 Zod runtime schema 和 inferred type，并通过 fixture/契约测试验证；Python model 与 OpenAPI 保持 parity。

## Consequences

Frontend、Backend、Agent 可并行开发且 Mock/Real 可替换；Contract 变更需要更严格 review 和跨语言自动化。
