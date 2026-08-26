# 服务边界

| 领域           | 正式事实拥有者       | Agent 可做                       | Agent 禁止             |
| -------------- | -------------------- | -------------------------------- | ---------------------- |
| User/Auth      | Product API          | 读取最小授权身份上下文           | 创建账号、修改认证状态 |
| Journey        | Product API          | 根据已提交答案生成 Draft         | 修改 Journey 答案      |
| Persona        | Persona Service      | 读取版本、提出 Patch Candidate   | 创建正式 Version       |
| Memory         | Product API/Worker   | 检索、提出 Memory Candidate      | 把事件直接变成人格结论 |
| Conversation   | Product API          | 生成响应、反思候选               | 绕过 Message 持久化    |
| Relationship   | Relationship Service | 读取上下文、提出观察             | 改变正式 stage/trust   |
| Recommendation | Product API          | 提出 Candidate 和理由            | 代表用户接受关系       |
| Consent        | Consent Service      | 请求授权、执行 disclosure policy | 授予或恢复已撤销授权   |

## 调用方向

- Browser → Product API：公开产品接口。
- Product API → Agent Service：内部 `/v1/*` 接口，只传所需 Contract。
- Product API → PostgreSQL/Redis：事实写入和事件协调。
- Worker → Product command/repository：幂等提交候选，不让 Agent 直写数据库。

## 失败策略

- Contract 校验失败：400/502 并记录不含隐私的结构化错误。
- Agent 不可用：产品可展示可恢复状态；生产不得静默冒充成功或切 Mock。
- Consent 缺失/撤销：Proxy `ASK_USER` 或 `DENY`，默认 fail closed。
- Candidate fromVersion 过期：409 conflict，不静默分叉 Persona 历史。
