import { ProductError } from "./product-error.js";
import type { Pool, QueryResultRow } from "pg";

export interface RateLimiter {
  consume(key: string, now?: number): Promise<void>;
}

export class InMemoryWindowRateLimiter implements RateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
  ) {}

  async consume(key: string, now = Date.now()): Promise<void> {
    const active = (this.requests.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );
    if (active.length >= this.limit) {
      throw new ProductError("RATE_LIMITED", "Too many Assist requests", true);
    }
    active.push(now);
    this.requests.set(key, active);
  }
}

export class PostgresWindowRateLimiter implements RateLimiter {
  constructor(
    private readonly pool: Pool,
    private readonly limit = 10,
    private readonly windowMs = 60_000,
  ) {}

  async consume(key: string, now = Date.now()): Promise<void> {
    const windowStartedAt = new Date(now);
    const expiresAt = new Date(now + this.windowMs);
    const result = await this.pool.query<{ request_count: number } & QueryResultRow>(
      `INSERT INTO rate_limit_buckets (key, window_started_at, request_count, expires_at)
       VALUES ($1,$2,1,$3)
       ON CONFLICT (key) DO UPDATE SET
         window_started_at = CASE
           WHEN rate_limit_buckets.expires_at <= $2 THEN $2
           ELSE rate_limit_buckets.window_started_at
         END,
         request_count = CASE
           WHEN rate_limit_buckets.expires_at <= $2 THEN 1
           ELSE rate_limit_buckets.request_count + 1
         END,
         expires_at = CASE
           WHEN rate_limit_buckets.expires_at <= $2 THEN $3
           ELSE rate_limit_buckets.expires_at
         END
       RETURNING request_count`,
      [key, windowStartedAt.toISOString(), expiresAt.toISOString()],
    );
    if ((result.rows[0]?.request_count ?? this.limit + 1) > this.limit) {
      throw new ProductError("RATE_LIMITED", "Too many Assist requests", true);
    }
  }
}
