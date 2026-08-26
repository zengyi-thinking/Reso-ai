# ADR-0003: Memory vs Persona

**Status:** Accepted  
**Date:** 2026-08-26

## Decision

Memory 与 Persona 使用独立实体和生命周期。任何 Persona 变化必须经过 Evidence、Patch Candidate、用户确认与新 Version；Correction Memory 优先于冲突的旧假设。

## Consequences

避免一次事件成为人格真理，支持解释、纠正和审计；需要额外 Candidate/Version workflow 与 UI。
