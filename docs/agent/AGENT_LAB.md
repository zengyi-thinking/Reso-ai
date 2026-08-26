# Reso Agent Lab

Agent Lab 是仅用于开发与评估的 synthetic workspace，不是 Product API，也不是业务事实来源。当前固定用户 `user-alice` 完全虚构；Session、Memory ablation 与 Persona Preview 都只保存在 Agent Service 进程内存中，重启即丢失。

## 启动

```bash
pnpm --filter @reso/agent-lab dev
uv run --project apps/agent-service uvicorn reso_agent.app:app --reload --port 8000
```

浏览器打开 `http://localhost:5174`。默认使用 deterministic provider，不需要模型 Key。

## 真实 MiniMax（仅手动 opt-in）

使用标准环境变量：

```text
LLM_PROVIDER=minimax
LLM_MODEL=<MiniMax model id>
LLM_API_KEY=<secret>
LLM_BASE_URL=https://api.minimax.io/v1
```

也兼容本地既有的 `MINIMAX_*` / `MiniMax_*` 别名。选择 `MiniMax · Opt-in` 后，如果配置缺失或调用失败，Lab 会明确显示错误；不会退回 deterministic。

## 调试流程

1. 新建 Alice Session，运行 Day 1，观察疲惫消息保持 Companion。
2. 运行 Day 7，查看 correction Memory、Pending Persona Patch 和 evidence。
3. 在 Persona 面板 Accept / Reject / Edit；Accept 只生成 `1.1-preview`。
4. 在 Memory 面板 Disable correction，回到 Turn Inspector Replay 同一输入，对比 Retrieval 和回答。
5. 运行 Day 30，检查 Mirror / Preprocessor、相关 Recall 与 Human Touch eval。

Inspector 只展示 allowlist 字段：Persona slice、Memory 评分、Mode reason、Context summary、provider/model/latency/token usage、Candidate、Eval 与 trace ID。禁止展示 Chain-of-Thought、密钥或完整 provider 响应。

当前核心模式使用 `companion/v2`、`mirror/v2` 与 `preprocessor/v2`。v2 在 v1 边界上增加 anti-overanalysis、单问题与默认 120 中文字符限制；`proxy/v1` 未改变。

## API

- `GET /v1/lab/users`
- `POST /v1/lab/sessions`
- `GET|DELETE /v1/lab/sessions/{id}`
- `POST /v1/lab/sessions/{id}/turns`
- `POST /v1/lab/sessions/{id}/simulate/{1|7|30}`
- `PATCH /v1/lab/sessions/{id}/memories/{memoryId}`
- `PATCH /v1/lab/sessions/{id}/patches/{patchId}`

这些接口只允许 synthetic fixture，不得接入真实用户数据。
