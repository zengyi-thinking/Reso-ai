# Social Protocol

Agent ↔ Agent 必须由 Social Orchestrator 通过有界 `SocialMission` 协调，禁止无限自由聊天。

Mission 包含 initiator/target、goal、max turns、allowed/forbidden topics、disclosure level、budget 和 stop conditions。每一轮先执行 disclosure policy，再决定是否允许工具或模型行动。

结果只包含 summary、interesting points、shared topics、conflicts、open questions、recommendation candidate、confidence、turns used 和 stop reason。它不能创建正式 Recommendation、Relationship 或 Consent。

Disclosure Level：L0 Internal、L1 Public、L2 Social、L3 Relationship、L4 Private、L5 Secret。Proxy 对外内容必须得到 `ALLOW`；`ASK_USER` 需要新的明确确认；`consent.revoked` 立即使后续任务失效。
