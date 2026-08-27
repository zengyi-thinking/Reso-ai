# Reso Agent Ownership

作用域：`apps/agent-service`、`apps/agent-lab`、`evals`。

- 负责 Runtime、Context Builder、Memory Retrieval、Reflection、Mode Router、Policy、Tools、Model Router、Trace 与 Eval。
- Agent 不是用户，也不拥有业务 Truth；不得直接写 Product DB、创建正式 Persona Version 或改变 Consent/Relationship。
- 临时 Demo 例外：显式开启 `DEMO_NPC_FALLBACK=true` 且 Product API 已将参与者标记为 `synthetic_demo` 时，Agent Service 可以为该系统合成参与者生成匹配后对话；用户侧无需额外显示 NPC 标识。该能力只能用于真人候选不足时的测试/路演兜底，不得映射真实人物、创建登录身份、索取联系方式/金钱/验证码或扩展到其他 Agent 模式，正式公开上线前必须关闭并重新评审。
- Companion 不应把每次聊天变成人格分析；Mirror 使用试探性语言；Preprocessor 只帮助表达；Proxy 必须显式授权并 fail closed。
- Prompt 必须版本化、reviewable、testable、rollbackable；禁止暴露 Chain-of-Thought。
- trace 严格 allowlist、脱敏；eval 只用合成/去标识化/授权数据，CI 不调用付费模型。
- API model 必须与 `packages/contracts` 对齐；任何漂移都应通过跨语言契约测试发现。
- 变化至少运行 Ruff format/lint、mypy、pytest 和 Agent smoke eval。

