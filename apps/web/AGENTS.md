# Web Ownership

作用域：`apps/web`、`packages/ui`、`packages/design-tokens`。

- 负责 Mobile UI、Onboarding、Journey、Persona、Agent Chat、Explore、Relationships、Profile、动效和响应式。
- 只能通过 Product API 和 `@reso/contracts` 交互；禁止直连数据库、Agent Service 或 LLM。
- 不得定义私有后端 DTO、修改 Agent Prompt 或把 Persona hypothesis 呈现成事实。
- 延续温暖、治愈、绘本、天空、群岛、旅行与成长的视觉语言；禁止黑紫赛博、传统 SaaS Dashboard 和 Tinder 卡片滑动。
- 新交互必须覆盖 loading/empty/error/disabled/focus 状态；触控目标至少 44px；尊重 reduced-motion。
- UI 变化至少运行 `pnpm --filter @reso/web lint typecheck test build`，并提供移动端和桌面截图。
