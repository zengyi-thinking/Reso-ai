# ADR-0001: Monorepo Architecture

**Status:** Accepted  
**Date:** 2026-08-26

## Context

Frontend、Backend、Agent 需要共享 Contracts 和质量门禁，同时保持 ownership 清晰。

## Decision

使用 pnpm workspace + Turborepo 管理 TypeScript apps/packages；Python Agent 保留独立 uv project 但位于同一仓库。

## Consequences

依赖和 CI 可统一，跨团队改动可原子 review；需警惕无边界跨包 import。通过 scoped AGENTS、package exports 和 dependency direction 控制。
