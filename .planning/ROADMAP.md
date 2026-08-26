# Roadmap: Reso.AI

## Overview

Reso.AI 按 `Understand → Remember → Reflect → Connect → Experience → Grow` 的依赖顺序推进：先验证可并行开发、可替换、可测试的工程 Foundation；再交付 Journey 到 Persona V1.1 的首个用户闭环；随后用长期记忆、纠正优先级与 Eval 提升 Agent 质量；在明确 Disclosure、预算和停止条件后开放受控 Agent 社交；最终只在双方 Consent 下帮助真人建立、维持和反思关系。每个阶段都以前一阶段的用户可观察闭环、隐私边界和评估通过为进入条件。

## Phases

- [ ] **Phase 1: Foundation / Project Bootstrap** - 验证工程骨架、契约、数据权威、Mock/Agent 接缝与全部质量门禁可重复运行。
- [ ] **Phase 2: First Closed Loop** - 用户可从 Journey 形成 Persona V1，并在受控 Agent 对话与确认后演进为 Persona V1.1。
- [ ] **Phase 3: Agent Quality** - 长期记忆、纠正优先检索、隐私生命周期、Agent Lab 与确定性 Eval 共同约束 Agent 质量。
- [ ] **Phase 4: Social Agent** - 用户可让 Agent 在 Disclosure、Consent、预算和停止条件内探索 Reso World 并提出推荐候选。
- [ ] **Phase 5: Human Relationship** - 双方 Consent 后用户可直接沟通、获得受控 Agent Assist，并从真实经历中形成可确认的关系与 Persona 演进。

## Phase Details

### Phase 1: Foundation / Project Bootstrap
**Goal**: 开发者可在不依赖真实模型或密钥的环境中，沿清晰 ownership 和 Contract 边界并行开发、启动、测试与验证 Reso.AI。
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11, FND-12, FND-13, FND-14, FND-15, FND-16, FND-17, FND-18, FND-19, FND-20, FND-21, FND-22
**Success Criteria** (what must be TRUE):
  1. 新开发者可按文档从干净 checkout 安装依赖、启动 Web/API/Mock Agent/PostgreSQL/Redis，并看到 mobile-first Reso.AI Web v0。
  2. Web 只经 Product API 工作，Mock 与 Reso Agent adapter 可替换且返回相同受校验 Contract；Agent 无法直接提交正式业务状态。
  3. 一组 golden fixtures 可跨 TypeScript/Python/HTTP/event 边界被一致接受或拒绝，数据库 migration/seed/integration 路径可重复执行。
  4. trace、fixture、环境变量与浏览器产物不暴露密钥、真实私密对话、完整 provider 响应或私有 Chain-of-Thought。
  5. 根级和 CI 的全部 format、lint、typecheck、unit/contract test、build、Python checks 与 deterministic eval 门禁通过，最终架构审查无未解决越界。
**Plans**: TBD — implementation largely present; verification and gap-closure planning required
**UI hint**: yes

### Phase 2: First Closed Loop
**Goal**: 用户可完成 Journey、确认 Persona V1、领取 Reso Agent，并通过可审查的 Memory/Reflection/Patch 流程把 Persona 演进为 V1.1。
**Depends on**: Phase 1
**Requirements**: FCL-01, FCL-02, FCL-03, FCL-04, FCL-05, FCL-06, FCL-07, FCL-08, FCL-09, FCL-10, FCL-11, FCL-12, FCL-13, FCL-14
**Success Criteria** (what must be TRUE):
  1. 用户可从 Welcome 完成并恢复 Journey，查看、修改和确认带 evidence/confidence 的 Persona Draft 为不可变 Persona V1。
  2. 用户可领取 Reso Agent、跨会话恢复聊天，并获得符合 Companion/Mirror/Preprocessor 边界的回应。
  3. 对话会产生可追溯 Memory、Reflection 与 Persona Patch Candidate，但在用户确认前 active Persona 不改变。
  4. 用户可接受或拒绝 Patch；有效接受创建 V1.1，拒绝、过期或重放请求不会覆盖或重复版本。
  5. 用户明确纠正 Agent 后，相同被否定的简单标签不再作为确定结论出现。
**Plans**: TBD
**UI hint**: yes

### Phase 3: Agent Quality
**Goal**: 用户得到可持续、可纠正、可解释且可用确定性证据评估的长期 Agent 体验。
**Depends on**: Phase 2
**Requirements**: AQT-01, AQT-02, AQT-03, AQT-04, AQT-05, AQT-06, AQT-07, AQT-08, AQT-09
**Success Criteria** (what must be TRUE):
  1. Agent 能在授权范围内召回有来源的长期与关系记忆，并优先尊重用户 Correction Memory。
  2. 已撤销授权或已删除的内容不会进入 Agent 上下文，相关 memory、embedding、trace 与派生索引会按生命周期清理。
  3. 授权开发者可在 Agent Lab 查看脱敏 trace、固定 snapshot 重放 turn，并比较 Prompt/model/memory 变体。
  4. 每个 Prompt 版本都可 review、rollback，并通过覆盖八项质量维度的 deterministic eval 显示行为变化与回归。
**Plans**: TBD
**UI hint**: yes

### Phase 4: Social Agent
**Goal**: 用户可在可见、可撤销、有限预算的授权下，让 Reso Agent 探索世界并提出值得认识之人的 Recommendation Candidate。
**Depends on**: Phase 3
**Requirements**: SOC-01, SOC-02, SOC-03, SOC-04, SOC-05, SOC-06, SOC-07, SOC-08, SOC-09
**Success Criteria** (what must be TRUE):
  1. 用户可进入温暖的 Reso World，查看并控制 Agent Card 中可用于社交探索的信息。
  2. 用户可批准带 goal、topic 范围、轮次、预算、Disclosure 与停止条件的 Social Mission，任务必然在边界内结束。
  3. 每次 Proxy disclosure 都得到 ALLOW、DENY 或 ASK_USER 决策，撤销 Consent 后未完成和后续动作 fail closed。
  4. Mission 只产生可解释的交互摘要、关系/推荐候选；用户可接受、拒绝或忽略，Agent 不会直接建立真人关系。
**Plans**: TBD
**UI hint**: yes

### Phase 5: Human Relationship
**Goal**: 双方在持续可撤销的 Consent 下直接建立关系，Agent 只帮助表达和反思，并在真人沟通成立时退居辅助位置。
**Depends on**: Phase 4
**Requirements**: HUM-01, HUM-02, HUM-03, HUM-04, HUM-05, HUM-06, HUM-07, HUM-08
**Success Criteria** (what must be TRUE):
  1. 只有双方 Consent 范围匹配且未撤销时，用户才能建立关系并开始 Human Chat；任一方撤销后新互动立即停止。
  2. 用户可让 Agent 协助整理表达，但每次发送由用户确认，Agent 不冒充用户或替用户承诺。
  3. 用户可查看由真实 interaction 与 relationship events 构成的 Relationship Timeline，并控制关系相关 disclosure。
  4. 真实经历只产生可确认的 Memory、Reflection 与 Relationship/Persona Candidate，正式状态由 Product API 在用户确认后提交。
  5. 产品可用保护隐私的指标观察有意义连接、被理解感、Persona 纠正和关系延续，而不把参与时长当作唯一目标。
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation / Project Bootstrap | TBD | In progress — pending final verification | - |
| 2. First Closed Loop | 0/TBD | Not started | - |
| 3. Agent Quality | 0/TBD | Not started | - |
| 4. Social Agent | 0/TBD | Not started | - |
| 5. Human Relationship | 0/TBD | Not started | - |

## Coverage

- v1 requirements mapped: **62/62**
- Orphaned requirements: **0**
- Duplicate phase mappings: **0**
- Foundation status: implementation is largely present, but completion remains unclaimed until all quality gates and the final architecture review pass.

---
_Roadmap initialized: 2026-08-26_
