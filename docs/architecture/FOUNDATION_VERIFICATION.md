# Foundation 验收记录

**验收日期：** 2026-08-26  
**范围：** Project Bootstrap / Stage 0，不包含完整产品业务闭环。

## 结论

Foundation 工程目标已闭环：前端、Product API、Worker 与 Agent Service 可沿共享 Contract 独立开发和构建；默认 Mock 路径不需要模型 Key；PostgreSQL/pgvector migration、合成 seed、event outbox 与 Redis 可在隔离环境重复验证；Web/API/Agent 镜像可构建并通过 HTTP smoke。

本次验收不把页面占位、candidate schema 或 deterministic Agent 当作已完成的生产业务。Journey 持久化、Persona V1/V1.1 原子提交、长期 Memory、真实 Social Mission 与 Human Relationship 仍属于后续阶段。

## 自动化结果

| 验证项                                  | 命令/方式                                                                | 结果                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| TypeScript 格式、lint、类型、测试、构建 | `pnpm check` 中对应门禁                                                  | 通过                                                               |
| Contract golden parity                  | 同一 JSON fixture 经 Zod 与 Pydantic 接受/拒绝                           | 通过                                                               |
| Product API                             | health、无效请求 error envelope、Mock turn、真实 adapter schema/错误测试 | 通过                                                               |
| Worker                                  | committed outbox seam、幂等、retry、ACK、dead-letter                     | 通过                                                               |
| Python Agent                            | Ruff、mypy、pytest、deterministic eval                                   | 通过                                                               |
| 数据层                                  | `pnpm test:database`                                                     | migration、合成 seed、outbox/consumer/dead-letter、Redis PING 通过 |
| 本地开发                                | 使用 `.env.example` 启动 Turbo Web/API/Worker/Agent Lab                  | 通过                                                               |
| Docker images                           | Web、API、Agent Service build                                            | 通过                                                               |
| Docker HTTP smoke                       | 隔离端口检查 `/`、`/patch-review`、API/Agent `/v1/health`                | 均为 HTTP 200                                                      |
| Reference 保持可运行                    | 两套独立 Git 工作树测试/构建                                             | 299 + 67 + 161 tests 通过；两套前端 build 通过                     |

本机已有服务占用标准端口 `5173`、`5432` 与 `8000`，因此最终镜像 smoke 使用隔离端口和独立 Docker network；没有终止或修改这些外部服务。数据库验证使用独立 Compose project，并在结束后删除仅属于该验证 project 的临时 volume。

## Architecture Review

- 依赖方向保持为 `Web → Product API → IAgentClient → Mock/Reso Agent`；Web 不持有模型或数据库凭据。
- Product API 是正式 User/Journey/Persona/Relationship/Recommendation/Consent 状态的命令边界；Agent 只返回 candidate。
- `AgentTurn` 成功与错误边界均运行时校验；真实 provider 无 silent Mock fallback。
- Agent runtime 已预留 typed perception、authorized context、mode/prompt/model route、policy、plan 与 post-turn candidate 阶段。
- trace model 使用 `extra=forbid` allowlist，测试明确拒绝 Chain-of-Thought 和 provider raw payload。
- `event_outbox` 是异步事实接缝；Worker 只消费 committed delivery，并有可测试的幂等、重试、ACK 与 dead-letter 语义。Redis 只是传输/协调层。
- `Memory != Persona`、`Persona != Truth`、`Agent != User`、`Recommendation != Decision` 和 `Agent Suggests, Service Commits` 均未被实现绕过。

## 下一阶段入口条件

Stage 1 应以单一纵切实现 `Journey → Persona V1 → Agent Chat → Memory/Reflection → Patch Review → Persona V1.1`。进入真实用户或模型数据前，还必须完成认证/服务身份、隐私删除传播、生产 migration runner、trace 生命周期和 provider 成本/超时策略。
