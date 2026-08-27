# Reso Product Vertical Slice v0.1

## 用户闭环

`Welcome → Quick Start → Persona Draft → 用户修正/确认 → 邮箱验证码 → Guest 迁移 → Persona v1.0 + Primary Agent → Agent Birth → Conversation → Agent Event Stream`

本阶段不包含 Deep Search、Agent Hub、Agent↔Agent、Recommendation 或真人匹配。

## Ownership 与调用链

- Web 仅调用 Product API；浏览器不持有 SMTP 或 MiniMax 密钥，也不能提交 Persona/Memory 等授权上下文。
- Product API 拥有验证码、Guest、User、Persona Version、Agent 绑定、Conversation、Message 与 Memory Candidate。
- Product API 从数据库加载当前用户、Primary Agent、已确认 Persona、已启用 Memory 与最近消息，再通过 `IAgentClient` 调用 Agent Service。
- Agent Service 只生成 Persona Draft 或 Agent 候选输出；正式状态由 Product API 校验并提交。

## 邮箱验证码

- `POST /api/auth/email/send-code` 发送六位数字验证码。
- `POST /api/auth/email/verify-code` 校验并自动注册/登录。
- `GET /api/auth/me` 恢复用户、Agent 和 Persona。
- `DELETE /api/session` 注销服务端 Session。
- 数据库只保存 SHA-256 验证码哈希；验证码有效期 5–10 分钟、单次消费、60 秒重发冷却、默认最多五次尝试。
- QQ SMTP 由 `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_AUTH_CODE/SMTP_FROM` 配置；授权码不得进入源码、文档、测试、日志或 Git。

## Guest 与 Persona

- 浏览器只保存不可推导身份的 Guest Token；数据库保存 Token Hash。
- Quick Start 的 MBTI/星座仅进入 `identity` weak evidence，不能推导 Persona 结论。
- 用户编辑会作为 `onboarding_corrections` 保存；领取时同时写入高优先级 `correction` Memory。
- 领取事务创建 `persona_profile → persona_version v1.0 → primary agent → user_id ↔ agent_id`。Agent 表不复制 Persona。

## 对话与公开事件

- `POST /api/conversations` 创建第一段对话。
- `GET /api/conversations/:id` 恢复正式消息和公开事件。
- `POST /api/conversations/:id/turns/stream` 通过 SSE 发送 `status/public_reflection/message/done/error`。
- 用户消息先持久化；模型失败仍保留消息和可重试入口。
- `public_events` 只包含经过契约验证的公开表达，不包含 provider 原始响应、`reasoning_details` 或 Chain-of-Thought。
- Agent 返回的 Memory Candidate 进入 `memory_candidates` 待审，不直接成为正式 Memory。

## 本地配置

正式持久化联调使用 `PRODUCT_REPOSITORY=postgres` 与 `SESSION_PROVIDER=postgres`，先运行数据库 migration。测试使用显式注入的 In-memory Repository、测试 Mailer 和 Deterministic Agent，不调用付费模型或真实邮箱。
