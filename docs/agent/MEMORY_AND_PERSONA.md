# Memory and Persona

## 核心区别

- Memory：发生过什么，包括 episodic、persona_related、relationship、correction、reflection。
- Persona：Reso 当前如何理解这个人，是可解释、可修正、可版本化的模型，不是真理。

```text
Event → Memory → Evidence → Pattern → Hypothesis
      → Persona Patch Candidate → User Confirmation → Persona Version
```

一次事件不能直接更新 Persona。Patch Candidate 必须记录 `fromVersionId`、JSON path、old/proposed value、reason、evidence IDs、confidence 和 status。Product API 检查 from version 和用户决定后才提交新版本。

Correction Memory 高优先级：用户明确否认“慢热”等简单解释后，后续检索必须带回这次纠正，并抑制冲突的旧假设。
