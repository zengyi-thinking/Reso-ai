# 当前仓库状态

**审计日期：** 2026-08-26  
**审计结论：** 根仓库需要正式初始化；`references/` 中有两套拥有独立 Git 历史的可运行参考实现，应保持只读并渐进吸收，不直接并入新 workspace。

## 初始化前审计

| 检查项                                     | 结果                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 根 `README.md` / `package.json` / app 结构 | 不存在，本轮创建                                                                                    |
| `references/Reso-AI-upstream`              | 独立 Git；191 个文件、49 个测试、28 个图片资产；Vite 7 + vanilla JS + Node 同源 server              |
| 上游 Journey/World                         | 十岛关系剧情、雾谷/爬山/家庭/工作等场景、地图/移动/进度系统可运行                                   |
| 上游 Persona 能力                          | evidence、portrait、partner preferences、Personal Manual 和 relationship tools 可作为行为参考       |
| 上游模型调用                               | 服务端 `modelGateway`/`icebreakerService`；浏览器不持有 key，具有限流/并发/取消接缝                 |
| `references/Reso.Ai`                       | 独立 Git；323 个文件、57 个测试、70 个图片资产；Next.js 16 + FastAPI/SQLAlchemy 原型                |
| 第二套产品能力                             | Story → Manual → Agent → Encounter → Match → Consent → Reveal；含 Plaza、Privacy、Human Chat 与 E2E |
| 根 Git                                     | 初始化前不存在，本轮创建；两个 reference repo 保留独立 Git 历史                                     |

根目录不适合把任一参考实现原样提升为新架构：第一套是 vanilla JS 游戏/同源 server，第二套已经包含较完整但耦合较高的 Next.js + FastAPI 产品原型。两者都保留为只读迁移源，不加入 `pnpm-workspace.yaml`，不改变其 Git 工作树。

## 可复用与迁移判断

- **优先复用行为与内容**：Journey 场景/进度规则、evidence 安全表达、Personal Manual 校验案例、Consent/Privacy 交互和现有测试用例。
- **优先复用资产**：岛屿、角色、地图和像素/绘本资产先做来源与许可清单，再复制到 `apps/web/public/assets`；原件始终保留。
- **通过防腐层迁移**：将旧 evidence/manual 数据适配到新 Contracts，不让旧 schema 成为永久公共接口。
- **不直接复用**：旧 model gateway、浏览器 localStorage truth、Next.js 页面内部 DTO、直接耦合的 Agent/业务状态逻辑。
- **暂时不要动**：两个 reference repo 的代码、构建和资产；先以现有命令验证可运行，再按 Stage 1 一个纵切逐步搬迁。

## 初始化后的状态

- pnpm + Turborepo TypeScript workspace 已建立。
- Web、Product API、Worker、Agent Service、Agent Lab 均有独立边界和可构建骨架。
- Contracts 同时提供运行时 Zod 校验和 TypeScript 类型。
- PostgreSQL/pgvector schema、Redis 边界、真实 Reso Agent adapter、Docker 和 CI 已建立。
- First Closed Loop 已具备基础 Contract、真实 Agent 路由、UI 路由和确定性测试接缝；完整生产业务仍在演进。
- 两套 reference repo 仍为干净 Git 工作树，根工具链通过 ignore 排除它们。

## Foundation 验收后状态

- TypeScript/Python 已共享 AgentTurn golden fixture；更广泛的 schema 生成仍留给 Stage 1。
- `pnpm test:database` 已在隔离 PostgreSQL/pgvector + Redis 环境验证 migration、合成 seed 和 outbox 表。
- Worker 已具备 committed outbox 消费接缝以及幂等、retry、ACK、dead-letter 测试；真实 Redis Stream/PostgreSQL adapter 留给首个业务纵切。
- Web 已补齐 Welcome、Journey、Persona、Agent Chat 和 Patch Review Foundation 路由，并保持 Product API 单向依赖。
- Agent Runtime 是 typed deterministic bootstrap，trace 使用 fail-closed allowlist；尚不启用真实模型、检索和工具执行。
- Web/API/Agent Docker images 已构建并通过隔离网络 HTTP smoke；详细结果见 [Foundation 验收记录](FOUNDATION_VERIFICATION.md)。

## 成长闭环落地后状态（2026-08-27）

- `/v1/agent/reflect` 与 `/v1/persona/suggest-patch` 已是真实实现：`runtime/reflection_tasks.py` 配合版本化 Prompt `prompts/reflection/v1.md`，evidence 强制引用 transcript 内 message id，候选统一 pending + requiresReview。
- Worker 经 `message.created` Outbox 驱动成长闭环：会话水位之上累计用户消息达到 `WORKER_REFLECTION_THRESHOLD`（默认 4）触发一次 reflect，候选写入 memory_candidates / persona_patch_candidates 并推进 watermark。
- Memory Retrieval 升级为可解释 lexical baseline + 可选向量混合；Embedding 计算全部收在 Agent Service 内部端点 `/v1/embeddings`（固定 1536 维）。
- Tools Registry 上线首个确定性工具 `memory_deep_recall`，TraceRecord 已填充 `tool_names`。
- `/api/memory-candidates*` 与 `/api/persona-patches*` 四条审阅路由打通 Candidate → 用户决定链路。

## 下一阶段技术债与耦合点

1. 生产 trace sink 与成本/超时策略尚未实现。
2. outbox/Worker 语义已固定，PostgreSQL claim/publish 与 Redis Streams adapter 尚未接线。
3. 数据删除传播与 Consent 生命周期需要在接触真实用户数据前补齐。
4. Growth Loop 尚缺 Persona Version bump 流程：patch accept 只标记 accepted，版本晋升待做。
5. 社交任务（social act/evaluate）仍为 stub；knowledge provider 为空实现，corpus 尚未接入检索。
