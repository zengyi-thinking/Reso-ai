# Database schemas

正式结构以 `database/migrations/` 的顺序化 SQL 为准。业务事实由 Product API 持有；Agent Service 不获得直接写权限。后续若引入 schema dump，必须由 migration 自动生成，禁止手工分叉。
