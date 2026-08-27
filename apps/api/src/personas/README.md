# Personas boundary

拥有正式 Persona Profile/Version，并负责接受或拒绝 Agent 提出的 Patch Candidate。

Journey 完成产生的 Personal Manual 只是可展示 Snapshot；只有用户点击“领取我的 Agent”时，
Product API 才以当前 Manual 创建 `confirmedByUser=true` 的 Persona V1。该事务同时关联长期
Reso Agent，并通过 Manual 唯一关联和数据库行锁保证幂等。
