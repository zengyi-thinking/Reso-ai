# 深度关系公开思考流程

## 目的

`relationship_deep_dive` 是聊天页可选的 Public Process，不是隐藏 Chain-of-Thought。它把 Agent 已获授权、可审计的检查步骤逐项告诉用户，帮助用户理解 Reso 正在关注什么，而不暴露 MiniMax 的私有推理、`reasoning_details` 或原始响应。

普通聊天默认使用 `adaptive`。只有用户主动开启“深度关系思考”时，才使用四步长链路。

## 四步模板

1. **先找一个具体共鸣**：寻找微偏好、具体生活切片或真正引发好奇的细节，避免用 MBTI 等粗标签代替认识。
2. **再看看边界**：检查明确边界、价值方向、不可勉强的差异和潜在伤害；证据不足时公开说明不足。
3. **比较相处的节奏**：比较沟通、支持和压力反应的节奏，允许差异，但不进行人格诊断。
4. **最后预演一下难处**：只有上下文充分时才提出一个可能的摩擦场景；没有对方信息或双方授权时不得伪造冲突模拟。

阶段标签由 Runtime 控制，阶段正文由模型根据当前授权的 Persona、Memory、Relationship Context 和用户消息生成。正文必须通俗、具体、不下过早结论；如果模型未返回合规的公开步骤，Runtime 使用同一上下文生成保守降级文案。

## 事件与产品边界

- Product Web 只调用 Product API，并通过 `publicProcessMode` 选择 `adaptive` 或 `relationship_deep_dive`。
- Product API 通过 `IAgentClient` 转发 Agent Service 的 SSE，并保存公开 `status`、`public_reflection` 与 `message` 事件。
- 刷新后过程卡可以重放已公开内容；临时呼吸动画不保存为人格或记忆事实。
- Agent 只提出理解和候选建议；Service 仍负责正式状态与写入。
- 未授权的他人 Persona、Memory、关系信息不得进入步骤正文。

## 动效与频率

- 当前步骤使用轻呼吸，完成后转为静态步骤。
- 前端按事件顺序呈现，并把额外视觉延迟限制在每轮 900ms 内。
- `prefers-reduced-motion` 下取消呼吸、位移和人为等待。
- `adaptive` 允许直接回答；不得为了展示过程而把简单问题复杂化。
