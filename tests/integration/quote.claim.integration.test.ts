import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db.js";
import {
  claimPendingQuotes,
  insertQuote,
  markQuoteCompleted,
  releaseQuoteClaim,
} from "../../src/quotes/quote.repository.js";
import type { QuoteStatus } from "../../src/quotes/quote.types.js";

type ClaimState = {
  status: QuoteStatus;
  claimed_by: string | null;
  claimed_at: Date | null;
};

async function seedQuote(status: QuoteStatus = "PENDING"): Promise<string> {
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

async function seedPendingQuotes(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(await seedQuote("PENDING"));
  }
  return ids;
}

async function claimStateOf(id: string): Promise<ClaimState> {
  const result = await pool.query<ClaimState>(
    "SELECT status, claimed_by, claimed_at FROM quotes WHERE id = $1",
    [id],
  );
  return result.rows[0];
}

async function statusOf(id: string): Promise<QuoteStatus> {
  return (await claimStateOf(id)).status;
}

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

describe("claimPendingQuotes (PostgreSQL)", () => {
  it("moves claimed quotes to PROCESSING and records claimed_by and claimed_at", async () => {
    const ids = await seedPendingQuotes(3);

    const claimed = await claimPendingQuotes(10, "worker-a");

    expect(claimed.sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const state = await claimStateOf(id);
      expect(state.status).toBe("PROCESSING");
      expect(state.claimed_by).toBe("worker-a");
      expect(state.claimed_at).toBeInstanceOf(Date);
    }
  });

  it("new quotes start unclaimed", async () => {
    const [id] = await seedPendingQuotes(1);

    expect(await claimStateOf(id)).toMatchObject({
      status: "PENDING",
      claimed_by: null,
      claimed_at: null,
    });
  });

  it("claims at most N quotes, oldest first", async () => {
    const ids = await seedPendingQuotes(5);

    const claimed = await claimPendingQuotes(2, "worker-a");

    expect(claimed.sort()).toEqual(ids.slice(0, 2).sort());
    expect(await claimStateOf(ids[2])).toMatchObject({
      status: "PENDING",
      claimed_by: null,
    });
  });

  it("only claims PENDING quotes", async () => {
    const pendingId = await seedQuote("PENDING");
    const others = await Promise.all(
      (["PROCESSING", "COMPLETED", "FAILED", "REJECTED"] as const).map((s) =>
        seedQuote(s),
      ),
    );

    const claimed = await claimPendingQuotes(10, "worker-a");

    expect(claimed).toEqual([pendingId]);
    for (const id of others) {
      expect((await claimStateOf(id)).claimed_by).toBeNull();
    }
  });

  it("does not transition an already-claimed quote PENDING → PROCESSING a second time", async () => {
    const [id] = await seedPendingQuotes(1);

    const first = await claimPendingQuotes(1, "worker-a");
    const firstState = await claimStateOf(id);
    const second = await claimPendingQuotes(1, "worker-b");

    expect(first).toEqual([id]);
    expect(second).toEqual([]);
    expect(await claimStateOf(id)).toEqual(firstState);
  });

  it("leaves stale PROCESSING quotes alone (no recovery)", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await pool.query(
      "UPDATE quotes SET claimed_at = now() - interval '1 day' WHERE id = $1",
      [id],
    );

    expect(await claimPendingQuotes(10, "worker-b")).toEqual([]);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: "crashed-worker",
    });
  });

  it("gives a single quote to exactly one of many concurrent workers", async () => {
    const [id] = await seedPendingQuotes(1);
    const workers = Array.from({ length: 8 }, (_, i) => `worker-${i}`);

    const results = await Promise.all(
      workers.map((workerId) => claimPendingQuotes(1, workerId)),
    );

    const winners = workers.filter((_, i) => results[i].length > 0);
    expect(winners).toHaveLength(1);
    expect(results.flat()).toEqual([id]);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: winners[0],
    });
  });

  it("never claims the same quote twice across concurrent workers, and records the real owner", async () => {
    const ids = await seedPendingQuotes(30);
    const workers = Array.from({ length: 8 }, (_, i) => `worker-${i}`);

    const results = await Promise.all(
      workers.map((workerId) => claimPendingQuotes(5, workerId)),
    );
    const leftovers = await claimPendingQuotes(100, "worker-sweep");

    const allClaimed = [...results.flat(), ...leftovers];
    expect(allClaimed).toHaveLength(ids.length);
    expect(new Set(allClaimed)).toEqual(new Set(ids));

    const owners = await pool.query<{ id: string; claimed_by: string }>(
      "SELECT id, claimed_by FROM quotes",
    );
    const ownerById = new Map(owners.rows.map((r) => [r.id, r.claimed_by]));
    workers.forEach((workerId, i) => {
      for (const id of results[i]) {
        expect(ownerById.get(id)).toBe(workerId);
      }
    });
    for (const id of leftovers) {
      expect(ownerById.get(id)).toBe("worker-sweep");
    }
  });

  it("skips rows locked by an in-flight claim instead of blocking or double-claiming", async () => {
    const [id] = await seedPendingQuotes(1);
    const workerA = await pool.connect();

    try {
      await workerA.query("BEGIN");
      const claimedByA = await claimPendingQuotes(1, "worker-a", workerA);

      const claimedByB = await claimPendingQuotes(1, "worker-b");

      await workerA.query("COMMIT");
      const claimedAfterCommit = await claimPendingQuotes(1, "worker-b");

      expect(claimedByA).toEqual([id]);
      expect(claimedByB).toEqual([]);
      expect(claimedAfterCommit).toEqual([]);
      expect((await claimStateOf(id)).claimed_by).toBe("worker-a");
    } finally {
      await workerA.query("ROLLBACK").catch(() => undefined);
      workerA.release();
    }
  });

  it("commits the claim immediately so no transaction stays open for the caller", async () => {
    const [id] = await seedPendingQuotes(1);

    await claimPendingQuotes(1, "worker-a");

    const other = await pool.connect();
    try {
      const result = await other.query<{ status: QuoteStatus }>(
        "SELECT status FROM quotes WHERE id = $1",
        [id],
      );
      expect(result.rows[0].status).toBe("PROCESSING");
    } finally {
      other.release();
    }
  });

  it("releases a claim back to PENDING and clears claim metadata", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "worker-a");

    expect(await releaseQuoteClaim(id)).toBe(true);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PENDING",
      claimed_by: null,
      claimed_at: null,
    });
    expect(await claimPendingQuotes(1, "worker-b")).toEqual([id]);
  });
});

describe("markQuoteCompleted (PostgreSQL)", () => {
  it("completes a PROCESSING quote", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "worker-a");

    expect((await markQuoteCompleted(id))?.status).toBe("COMPLETED");
  });

  it.each(["PENDING", "COMPLETED", "FAILED", "REJECTED"] as const)(
    "refuses to complete a %s quote",
    async (status) => {
      const id = await seedQuote(status);

      expect(await markQuoteCompleted(id)).toBeNull();
      expect(await statusOf(id)).toBe(status);
    },
  );

  it("completes a claimed quote only once", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "worker-a");

    const results = await Promise.all([
      markQuoteCompleted(id),
      markQuoteCompleted(id),
    ]);

    expect(results.filter((quote) => quote !== null)).toHaveLength(1);
    expect(await statusOf(id)).toBe("COMPLETED");
  });
});
