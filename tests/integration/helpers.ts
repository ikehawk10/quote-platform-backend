import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { pool } from "../../src/db.js";
import {
  insertQuote,
  QUOTE_LEASE_SECONDS,
} from "../../src/quotes/quote.repository.js";
import type { QuoteClaim, QuoteStatus } from "../../src/quotes/quote.types.js";

export type ClaimState = {
  status: QuoteStatus;
  claimed_by: string | null;
  claimed_at: Date | null;
  lease_until: Date | null;
  claim_version: number;
};

/** Guards against a non-test database, truncates between tests, closes the pool. */
export function useTestDatabase(): void {
  beforeAll(async () => {
    const result = await pool.query<{ db: string }>(
      "SELECT current_database() AS db",
    );
    if (!result.rows[0].db.endsWith("_test")) {
      throw new Error(
        `Refusing to run destructive integration tests against "${result.rows[0].db}"`,
      );
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events, quotes");
  });

  afterAll(async () => {
    await pool.end();
  });
}

export async function seedQuote(status: QuoteStatus = "PENDING"): Promise<string> {
  const id = randomUUID();
  await insertQuote({
    id,
    first_name: "Test",
    last_name: "Driver",
    email: "test@example.com",
    address: "1 Main St",
    make: "Toyota",
    model: "Camry",
    year: 2020,
    date_of_birth: "1990-01-01",
    vin: null,
    state: "TX",
    status,
    rejection_reason: status === "REJECTED" ? "Unsupported state" : null,
  });
  return id;
}

export async function seedPendingQuotes(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(await seedQuote("PENDING"));
  }
  return ids;
}

export async function claimStateOf(id: string): Promise<ClaimState> {
  const result = await pool.query<ClaimState>(
    `SELECT status, claimed_by, claimed_at, lease_until, claim_version
     FROM quotes WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function statusOf(id: string): Promise<QuoteStatus> {
  return (await claimStateOf(id)).status;
}

/** Simulates a worker that claimed `id` and then stopped (crash / hang). */
export async function expireLease(
  id: string,
  expiredFor = "1 minute",
): Promise<void> {
  await pool.query(
    `UPDATE quotes
     SET claimed_at = now() - make_interval(secs => $3) - $2::interval,
         lease_until = now() - $2::interval
     WHERE id = $1`,
    [id, expiredFor, QUOTE_LEASE_SECONDS],
  );
}

export function leaseSeconds(state: ClaimState): number {
  return (state.lease_until!.getTime() - state.claimed_at!.getTime()) / 1000;
}

export function idsOf(claims: QuoteClaim[]): string[] {
  return claims.map((claim) => claim.quoteId);
}

export async function outboxCountFor(id: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*) FROM outbox_events WHERE aggregate_id = $1",
    [id],
  );
  return Number(result.rows[0].count);
}
