# ADR-0005: PostgreSQL + pgvector

**Status:** Accepted  
**Date:** 2026-08-26

## Decision

第一阶段使用 PostgreSQL 保存事务事实、pgvector 支持后续语义检索、Redis 支持简单异步任务。不引入 MongoDB、Neo4j、Pinecone、Kafka 或 Elasticsearch。

## Consequences

运维和一致性简单，满足 Bootstrap 与第一闭环；向量维度、索引和队列容量必须基于真实数据再优化。
