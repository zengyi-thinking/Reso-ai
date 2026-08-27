# Team Ownership

| Team     | Owns                                                | Does not own                                  |
| -------- | --------------------------------------------------- | --------------------------------------------- |
| Frontend | `apps/web`, `packages/ui`, `packages/design-tokens` | DB、LLM、Prompt、后端事实                     |
| Backend  | `apps/api`, `apps/worker`, `database`               | Web 页面、Agent 推理/Prompt                   |
| Agent    | `apps/agent-service`, `apps/agent-lab`, `evals`     | 正式业务 Truth、最终 Consent/Persona mutation |
| Shared   | `packages/contracts`, `packages/test-fixtures`      | 单方无 review 的破坏性变更                    |

跨边界需求先在 Contracts 和 ADR 中明确。团队可以基于确定性 fixtures 独立测试，集成时不交换私有 DTO，产品路径不得引入替代模型。
