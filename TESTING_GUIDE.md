# Reso.AI Backend 测试指南

这份指南用于验证“真人聊天 Agent Assist + 建立联系后的茶话会”。命令均在 PowerShell 中运行。

## 1. 进入项目并安装依赖

```powershell
cd 'D:\codex\shenicest黑客松2026.8.26\reso-ai-github版'
corepack pnpm install --frozen-lockfile
```

判断成功：最后没有红色 `ERR_`，并且项目根目录出现 `node_modules`。

如果看到 `minimum release age`，表示本机供应链策略认为某个依赖发布太新。不要删除锁文件；等待策略时间窗过去，或请技术负责人审核锁文件后再处理。

## 2. 一键运行后端自动测试

```powershell
corepack pnpm --filter @reso/contracts test
corepack pnpm --filter @reso/api test
corepack pnpm --filter @reso/worker test
```

本次开发的期望结果：

- Contracts：11 passed；
- API：无数据库环境 43 passed，设置测试数据库后 51 passed；
- Worker：5 passed；
- 完整后端合计：67 passed，0 failed。

API 的完整 51 个测试包含 8 个真实 PostgreSQL 集成测试。运行完整数据库测试前设置：

```powershell
$env:TEST_DATABASE_URL='postgresql://reso:reso@127.0.0.1:5432/reso'
```

如果出现 `failed`，不要只看最后一行。向上找到第一个 `FAIL`，它会标明失败文件、测试名和行号。

## 3. 运行类型、代码规范和构建检查

```powershell
corepack pnpm --filter @reso/contracts typecheck
corepack pnpm --filter @reso/api typecheck
corepack pnpm --filter @reso/worker typecheck
corepack pnpm --filter @reso/contracts lint
corepack pnpm --filter @reso/api lint
corepack pnpm --filter @reso/worker lint
corepack pnpm --filter @reso/contracts build
corepack pnpm --filter @reso/api build
corepack pnpm --filter @reso/worker build
```

判断成功：每条命令退出时没有 `error` 或 `failed`。

## 4. 启动本地 Mock 后端

先构建共享包：

```powershell
corepack pnpm --filter @reso/contracts build
corepack pnpm --filter @reso/config build
corepack pnpm --filter @reso/test-fixtures build
```

然后在一个新的 PowerShell 窗口运行：

```powershell
cd 'D:\codex\shenicest黑客松2026.8.26\reso-ai-github版'
$env:APP_ENV='development'
$env:API_PORT='3000'
$env:DATABASE_URL='postgresql://reso:reso@localhost:5432/reso'
$env:REDIS_URL='redis://localhost:6379/0'
$env:AGENT_PROVIDER='mock'
$env:MOCK_AGENT_FAILURE='none'
corepack pnpm --filter @reso/api dev
```

看到服务监听 `3000` 端口后，在另一个 PowerShell 窗口执行：

```powershell
Invoke-RestMethod 'http://localhost:3000/health'
```

期望返回：`service = reso-api`、`status = ok`。

注意：development 使用合成的内存数据和 Demo Session；它不会写正式数据库。production 不启用 Demo Session。

## 5. 两个账号与第三方越权测试

固定测试数据：

- 账号 A Session：`demo-user-a`
- 账号 B Session：`demo-user-b`
- 第三方 Session：`demo-third-party`
- Connection：`0198d4f3-2f34-7c52-95cc-7ff4f6f93c01`
- B 发给 A 的消息：`0198d4f3-2f34-7c52-95cc-7ff4f6f93d01`

准备请求头：

```powershell
$headersA = @{ Authorization = 'Bearer demo-user-a'; 'x-trace-id' = '0198d4f3-2f34-7c52-95cc-7ff4f6f93e01' }
$headersB = @{ Authorization = 'Bearer demo-user-b' }
$headersC = @{ Authorization = 'Bearer demo-third-party' }
$connection = '0198d4f3-2f34-7c52-95cc-7ff4f6f93c01'
$message = '0198d4f3-2f34-7c52-95cc-7ff4f6f93d01'
```

### A 分析 B 的消息

```powershell
$body = @{ messageId = $message; clientRequestId = 'manual-analyze-001' } | ConvertTo-Json
$assist = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/connections/$connection/assist/analyze" -Headers $headersA -ContentType 'application/json' -Body $body
$assist | ConvertTo-Json -Depth 8
```

期望：HTTP 200，`status` 为 `completed`，并返回 `interpretation`、`replyRoutes`、`traceId`。

### A 和 B 查询茶话会

```powershell
Invoke-RestMethod "http://localhost:3000/api/connections/$connection/tea-party" -Headers $headersA | ConvertTo-Json -Depth 8
Invoke-RestMethod "http://localhost:3000/api/connections/$connection/tea-party" -Headers $headersB | ConvertTo-Json -Depth 8
```

期望：两者均为 `ready`，消息 `turnNo` 从 1 到 8；同一个 speaker 对 A/B 显示的 `speakerLabel` 视角相反。

### 第三方尝试读取茶话会

```powershell
Invoke-WebRequest "http://localhost:3000/api/connections/$connection/tea-party" -Headers $headersC -SkipHttpErrorCheck
```

期望：HTTP 403，错误码 `CONNECTION_FORBIDDEN`。如果第三方得到 200，属于严重权限失败。

### B 或第三方尝试读取 A 的私有 Assist

```powershell
Invoke-WebRequest "http://localhost:3000/api/assist/$($assist.requestId)" -Headers $headersB -SkipHttpErrorCheck
Invoke-WebRequest "http://localhost:3000/api/assist/$($assist.requestId)" -Headers $headersC -SkipHttpErrorCheck
```

期望：两次都是 HTTP 403。Assist 结果只属于请求者 A，即使 B 是 Connection 另一方也不能读取。

## 6. 验证润色不会自动发送

```powershell
$polishBody = @{ draft = '你怎么又不回我'; clientRequestId = 'manual-polish-001' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/connections/$connection/assist/polish" -Headers $headersA -ContentType 'application/json' -Body $polishBody | ConvertTo-Json -Depth 8
```

期望：只返回 `candidates`，响应中没有自动发送字段。自动测试还会比较润色前后真人消息数量，确保没有新增消息。

## 7. 关闭 Agent 后验证真人聊天

停止 API（在运行窗口按 `Ctrl+C`），然后重新启动：

```powershell
$env:MOCK_AGENT_FAILURE='unavailable'
corepack pnpm --filter @reso/api dev
```

先调用润色：

```powershell
$offlineAssist = Invoke-WebRequest -Method Post -Uri "http://localhost:3000/api/connections/$connection/assist/polish" -Headers $headersA -ContentType 'application/json' -Body (@{ draft='你好'; clientRequestId='offline-assist-001' } | ConvertTo-Json) -SkipHttpErrorCheck
$offlineAssist.StatusCode
```

期望：503。

再发送真人消息：

```powershell
$human = Invoke-WebRequest -Method Post -Uri "http://localhost:3000/api/connections/$connection/messages" -Headers $headersA -ContentType 'application/json' -Body (@{ content='Agent 离线，但这条真人消息仍可发送'; clientMessageId='offline-human-001' } | ConvertTo-Json) -SkipHttpErrorCheck
$human.StatusCode
```

期望：201。这个结果说明 Agent 失败没有阻断真人聊天。

## 8. 实际执行数据库 Migration

Migration Runner 已实现，并在空 PostgreSQL 18 上实际验证。启动数据库后运行：

```powershell
cd 'D:\codex\shenicest黑客松2026.8.26\reso-ai-github版'
docker compose -p reso-ai-testing up -d postgres
docker compose -p reso-ai-testing ps
corepack pnpm --filter @reso/api db:migrate
corepack pnpm --filter @reso/api db:migrate
docker compose -p reso-ai-testing exec postgres psql -U reso -d reso -c "select to_regclass('public.connections'), to_regclass('public.agent_assist_requests'), to_regclass('public.event_outbox'), to_regclass('public.event_consumptions'), to_regclass('public.dead_letter_events');"
```

期望：PostgreSQL 显示 healthy；第一次迁移依次显示 4 个 `Migration applied`，第二次显示 4 个 `Migration already applied`；上述表名都不是空值。Runner 会保存 SHA-256 校验和，已应用 Migration 被改写时会拒绝继续。

测试结束后，只删除这个明确命名的测试项目：

```powershell
docker compose -p reso-ai-testing down -v
```

这会删除 `reso-ai-testing` 的测试数据库卷，不能用于保存了重要数据的环境。

## 9. 真实 Agent 联调

只有 Agent 团队给出地址、服务 Token 并确认共享 Contract 后再运行：

```powershell
$env:AGENT_PROVIDER='remote'
$env:AGENT_SERVICE_URL='https://你的-agent-staging地址'
$env:AGENT_SERVICE_TOKEN='由技术负责人提供'
$env:AGENT_TIMEOUT_MS='15000'
corepack pnpm --filter @reso/api dev
```

不要把 Token 提交到 Git。真实 Agent 尚未联调时，不能把 Mock 测试结果当作真实模型结果。
