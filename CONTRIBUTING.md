# Contributing to Reso.AI

## 工作方式

1. 从 `main` 创建短生命周期分支：`feat/*`、`fix/*`、`refactor/*`、`docs/*` 或 `test/*`。
2. 先确认 ownership 和 Contract 影响；跨团队字段先提交 `packages/contracts`。
3. 使用 Mock Agent 完成开发和测试，除非任务明确验证真实 Agent。
4. 小步提交，PR 使用仓库模板并说明所有影响面。

## 本地质量门禁

```bash
pnpm install
uv sync --project apps/agent-service
pnpm check
```

涉及 UI 时补充 mobile/desktop 截图；涉及 Agent 行为时补充 deterministic eval；涉及数据库时追加 migration，不修改已发布 migration。

## Review 要点

- 是否遵守 `Memory != Persona`、`Agent != User`、`Agent Suggests, Service Commits`。
- 是否存在新的隐私、授权、数据生命周期或 trace 风险。
- Mock/Real 是否继续共享完全相同的 Contract。
- 是否引入了本阶段不需要的复杂基础设施。
