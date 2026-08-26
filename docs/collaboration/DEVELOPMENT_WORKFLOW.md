# Development Workflow

1. 从 `main` 创建短生命周期分支。
2. 明确 ownership、Contract、DB、Agent behavior 和 UI 影响。
3. Contract First：先 schema/fixture/test，再 provider/consumer。
4. Mock First：Frontend/Backend 默认不等待真实 Agent。
5. 小步实现并运行受影响包检查；提交前运行 `pnpm check`。
6. PR 使用模板，附架构影响和 UI 截图；review 后合并。

数据库只追加 migration；Prompt 只通过版本化文件改变；Agent 行为变化必须有 deterministic eval。
