import { describe, expect, it } from "vitest";
import { pool } from "../../src/db.js";
import { completeQuoteWithOutbox } from "../../src/quotes/quote.completion.js";
import {
  claimPendingQuotes,
  markQuoteCompleted,
  reclaimExpiredQuotes,
  releaseQuoteClaim,
} from "../../src/quotes/quote.repository.js";
import type { QuoteStatus } from "../../src/quotes/quote.types.js";
import {
  claimStateOf,
  expireLease,
  idsOf,
  leaseSeconds,
  outboxCountFor,
  seedPendingQuotes,
  seedQuote,
  statusOf,
  useTestDatabase,
} from "./helpers.js";

useTestDatabase();

describe("claimPendingQuotes (PostgreSQL)", () => {
  it("moves claimed quotes to PROCESSING with an owner and a 60-second lease", async () => {
    const ids = await seedPendingQuotes(3);

    const claimed = await claimPendingQuotes(10, "worker-a");

    expect(idsOf(claimed).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const state = await claimStateOf(id);
      expect(state.status).toBe("PROCESSING");
      expect(state.claimed_by).toBe("worker-a");
      expect(state.claimed_at).toBeInstanceOf(Date);
      expect(state.lease_until!.getTime()).toBeGreaterThan(Date.now());
      expect(leaseSeconds(state)).toBe(60);
    }
  });

  it("new quotes start unclaimed at version 0", async () => {
    const [id] = await seedPendingQuotes(1);

    expect(await claimStateOf(id)).toMatchObject({
      status: "PENDING",
      claimed_by: null,
      claimed_at: null,
      lease_until: null,
      claim_version: 0,
    });
  });

  it("claims at most N quotes, oldest first", async () => {
    const ids = await seedPendingQuotes(5);

    const claimed = await claimPendingQuotes(2, "worker-a");

    expect(idsOf(claimed).sort()).toEqual(ids.slice(0, 2).sort());
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

    expect(idsOf(claimed)).toEqual([pendingId]);
    for (const id of others) {
      expect((await claimStateOf(id)).claimed_by).toBeNull();
    }
  });

  it("does not transition an already-claimed quote PENDING → PROCESSING a second time", async () => {
    const [id] = await seedPendingQuotes(1);

    const first = await claimPendingQuotes(1, "worker-a");
    const firstState = await claimStateOf(id);
    const second = await claimPendingQuotes(1, "worker-b");

    expect(idsOf(first)).toEqual([id]);
    expect(second).toEqual([]);
    expect(await claimStateOf(id)).toEqual(firstState);
  });

  it("does not pick up PROCESSING quotes, even with an expired lease", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await expireLease(id, "1 day");

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
    expect(results.flat()).toEqual([{ quoteId: id, version: 1 }]);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: winners[0],
      claim_version: 1,
    });
  });

  it("never claims the same quote twice across concurrent workers, and records the real owner", async () => {
    const ids = await seedPendingQuotes(30);
    const workers = Array.from({ length: 8 }, (_, i) => `worker-${i}`);

    const results = await Promise.all(
      workers.map((workerId) => claimPendingQuotes(5, workerId)),
    );
    const leftovers = await claimPendingQuotes(100, "worker-sweep");

    const allClaimed = idsOf([...results.flat(), ...leftovers]);
    expect(allClaimed).toHaveLength(ids.length);
    expect(new Set(allClaimed)).toEqual(new Set(ids));

    const owners = await pool.query<{ id: string; claimed_by: string }>(
      "SELECT id, claimed_by FROM quotes",
    );
    const ownerById = new Map(owners.rows.map((r) => [r.id, r.claimed_by]));
    workers.forEach((workerId, i) => {
      for (const id of idsOf(results[i])) {
        expect(ownerById.get(id)).toBe(workerId);
      }
    });
    for (const id of idsOf(leftovers)) {
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

      expect(idsOf(claimedByA)).toEqual([id]);
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

  it("releases a claim back to PENDING, clears ownership, and keeps the version", async () => {
    const [id] = await seedPendingQuotes(1);
    const [claim] = await claimPendingQuotes(1, "worker-a");

    expect(await releaseQuoteClaim(claim)).toBe(true);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PENDING",
      claimed_by: null,
      claimed_at: null,
      lease_until: null,
      claim_version: 1,
    });
    expect(await claimPendingQuotes(1, "worker-b")).toEqual([
      { quoteId: id, version: 2 },
    ]);
  });
});

describe("reclaimExpiredQuotes (PostgreSQL)", () => {
  it("reassigns an expired PROCESSING quote to the new worker with a fresh lease", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await expireLease(id);
    const before = await claimStateOf(id);

    const reclaimed = await reclaimExpiredQuotes(10, "worker-b");

    const after = await claimStateOf(id);
    expect(idsOf(reclaimed)).toEqual([id]);
    expect(after.status).toBe("PROCESSING");
    expect(after.claimed_by).toBe("worker-b");
    expect(after.claimed_at!.getTime()).toBeGreaterThan(before.claimed_at!.getTime());
    expect(after.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(leaseSeconds(after)).toBe(60);
  });

  it("never takes over a quote whose lease is still live", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "worker-a");
    const before = await claimStateOf(id);

    expect(await reclaimExpiredQuotes(10, "worker-b")).toEqual([]);
    expect(await claimStateOf(id)).toEqual(before);
  });

  it("only reclaims PROCESSING quotes", async () => {
    const pendingId = await seedQuote("PENDING");
    const terminal = await Promise.all(
      (["COMPLETED", "FAILED", "REJECTED"] as const).map((s) => seedQuote(s)),
    );
    for (const id of terminal) {
      await expireLease(id, "1 day");
    }

    expect(await reclaimExpiredQuotes(10, "worker-b")).toEqual([]);
    expect(await statusOf(pendingId)).toBe("PENDING");
    for (const id of terminal) {
      expect((await claimStateOf(id)).claimed_by).toBeNull();
    }
  });

  it("does not reclaim PROCESSING quotes that have no lease", async () => {
    const id = await seedQuote("PROCESSING");

    expect(await reclaimExpiredQuotes(10, "worker-b")).toEqual([]);
    expect((await claimStateOf(id)).claimed_by).toBeNull();
  });

  it("reclaims at most N quotes, longest-expired first", async () => {
    const ids = await seedPendingQuotes(3);
    await claimPendingQuotes(3, "crashed-worker");
    await expireLease(ids[0], "1 minute");
    await expireLease(ids[1], "1 hour");
    await expireLease(ids[2], "1 day");

    const reclaimed = await reclaimExpiredQuotes(2, "worker-b");

    expect(idsOf(reclaimed).sort()).toEqual([ids[1], ids[2]].sort());
    expect((await claimStateOf(ids[0])).claimed_by).toBe("crashed-worker");
  });

  it("does not reclaim the same quote twice once the new lease is live", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await expireLease(id);

    const first = await reclaimExpiredQuotes(1, "worker-b");
    const second = await reclaimExpiredQuotes(1, "worker-c");

    expect(idsOf(first)).toEqual([id]);
    expect(second).toEqual([]);
    expect((await claimStateOf(id)).claimed_by).toBe("worker-b");
  });

  it("gives an expired quote to exactly one of many concurrent reclaimers", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await expireLease(id);
    const workers = Array.from({ length: 8 }, (_, i) => `worker-${i}`);

    const results = await Promise.all(
      workers.map((workerId) => reclaimExpiredQuotes(1, workerId)),
    );

    const winners = workers.filter((_, i) => results[i].length > 0);
    expect(winners).toHaveLength(1);
    expect(results.flat()).toEqual([{ quoteId: id, version: 2 }]);
    expect(await claimStateOf(id)).toMatchObject({
      claimed_by: winners[0],
      claim_version: 2,
    });
  });

  it("never reclaims the same quote twice across concurrent workers, and records the real owner", async () => {
    const ids = await seedPendingQuotes(30);
    await claimPendingQuotes(30, "crashed-worker");
    for (const id of ids) {
      await expireLease(id);
    }
    const workers = Array.from({ length: 8 }, (_, i) => `worker-${i}`);

    const results = await Promise.all(
      workers.map((workerId) => reclaimExpiredQuotes(5, workerId)),
    );
    const leftovers = await reclaimExpiredQuotes(100, "worker-sweep");

    const allReclaimed = idsOf([...results.flat(), ...leftovers]);
    expect(allReclaimed).toHaveLength(ids.length);
    expect(new Set(allReclaimed)).toEqual(new Set(ids));

    const owners = await pool.query<{ id: string; claimed_by: string }>(
      "SELECT id, claimed_by FROM quotes",
    );
    const ownerById = new Map(owners.rows.map((r) => [r.id, r.claimed_by]));
    workers.forEach((workerId, i) => {
      for (const id of idsOf(results[i])) {
        expect(ownerById.get(id)).toBe(workerId);
      }
    });
  });

  it("skips a quote locked by an in-flight reclaim instead of blocking or double-reclaiming", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "crashed-worker");
    await expireLease(id);
    const workerB = await pool.connect();

    try {
      await workerB.query("BEGIN");
      const reclaimedByB = await reclaimExpiredQuotes(1, "worker-b", workerB);

      const reclaimedByC = await reclaimExpiredQuotes(1, "worker-c");

      await workerB.query("COMMIT");
      const reclaimedAfterCommit = await reclaimExpiredQuotes(1, "worker-c");

      expect(idsOf(reclaimedByB)).toEqual([id]);
      expect(reclaimedByC).toEqual([]);
      expect(reclaimedAfterCommit).toEqual([]);
      expect((await claimStateOf(id)).claimed_by).toBe("worker-b");
    } finally {
      await workerB.query("ROLLBACK").catch(() => undefined);
      workerB.release();
    }
  });

  it("concurrent claim and reclaim each take only their own kind of quote", async () => {
    const pendingIds = await seedPendingQuotes(5);
    const expiredIds = await seedPendingQuotes(5);
    await pool.query(
      "UPDATE quotes SET status = 'PROCESSING', claimed_by = 'crashed-worker' WHERE id = ANY($1)",
      [expiredIds],
    );
    for (const id of expiredIds) {
      await expireLease(id);
    }

    const [claimed, reclaimed] = await Promise.all([
      claimPendingQuotes(100, "worker-a"),
      reclaimExpiredQuotes(100, "worker-b"),
    ]);

    expect(new Set(idsOf(claimed))).toEqual(new Set(pendingIds));
    expect(new Set(idsOf(reclaimed))).toEqual(new Set(expiredIds));
  });
});

describe("claim version fencing (PostgreSQL)", () => {
  it("initial claim increments the version and hands it to the worker", async () => {
    const [id] = await seedPendingQuotes(1);

    const claims = await claimPendingQuotes(1, "worker-a");

    expect(claims).toEqual([{ quoteId: id, version: 1 }]);
    expect((await claimStateOf(id)).claim_version).toBe(1);
  });

  it("reclaim increments the version again", async () => {
    const [id] = await seedPendingQuotes(1);
    await claimPendingQuotes(1, "worker-a");
    await expireLease(id);

    const claims = await reclaimExpiredQuotes(1, "worker-b");

    expect(claims).toEqual([{ quoteId: id, version: 2 }]);
    expect((await claimStateOf(id)).claim_version).toBe(2);
  });

  it("the version only moves forward across claim, release, re-claim, and reclaim", async () => {
    const [id] = await seedPendingQuotes(1);

    const [first] = await claimPendingQuotes(1, "worker-a");
    await releaseQuoteClaim(first);
    const [second] = await claimPendingQuotes(1, "worker-b");
    await expireLease(id);
    const [third] = await reclaimExpiredQuotes(1, "worker-c");

    expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
  });

  it("a stale worker cannot complete after its quote was reclaimed; the new owner can", async () => {
    const [id] = await seedPendingQuotes(1);
    const [staleClaim] = await claimPendingQuotes(1, "worker-a");
    await expireLease(id);
    const [currentClaim] = await reclaimExpiredQuotes(1, "worker-b");

    expect(await markQuoteCompleted(staleClaim)).toBeNull();
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: "worker-b",
    });

    expect((await markQuoteCompleted(currentClaim))?.status).toBe("COMPLETED");
  });

  it("a stale worker cannot release a quote that was reclaimed", async () => {
    const [id] = await seedPendingQuotes(1);
    const [staleClaim] = await claimPendingQuotes(1, "worker-a");
    await expireLease(id);
    await reclaimExpiredQuotes(1, "worker-b");
    const ownedByB = await claimStateOf(id);

    expect(await releaseQuoteClaim(staleClaim)).toBe(false);
    expect(await claimStateOf(id)).toEqual(ownedByB);
  });

  it("a stale worker cannot complete after its claim was released and re-claimed", async () => {
    const [id] = await seedPendingQuotes(1);
    const [staleClaim] = await claimPendingQuotes(1, "worker-a");
    await releaseQuoteClaim(staleClaim);
    const [currentClaim] = await claimPendingQuotes(1, "worker-b");

    expect(await markQuoteCompleted(staleClaim)).toBeNull();
    expect(await releaseQuoteClaim(staleClaim)).toBe(false);
    expect((await claimStateOf(id)).claimed_by).toBe("worker-b");
    expect((await markQuoteCompleted(currentClaim))?.status).toBe("COMPLETED");
  });

  it("a release cannot be replayed", async () => {
    const [id] = await seedPendingQuotes(1);
    const [claim] = await claimPendingQuotes(1, "worker-a");

    expect(await releaseQuoteClaim(claim)).toBe(true);
    expect(await releaseQuoteClaim(claim)).toBe(false);
    expect(await statusOf(id)).toBe("PENDING");
  });

  it("when stale and current owners complete concurrently, only the current owner wins", async () => {
    const [id] = await seedPendingQuotes(1);
    const [staleClaim] = await claimPendingQuotes(1, "worker-a");
    await expireLease(id);
    const [currentClaim] = await reclaimExpiredQuotes(1, "worker-b");

    const [staleResult, currentResult] = await Promise.all([
      markQuoteCompleted(staleClaim),
      markQuoteCompleted(currentClaim),
    ]);

    expect(staleResult).toBeNull();
    expect(currentResult?.status).toBe("COMPLETED");
  });

  it("a stale completion writes no outbox event; the current owner's writes exactly one", async () => {
    const [id] = await seedPendingQuotes(1);
    const [staleClaim] = await claimPendingQuotes(1, "worker-a");
    await expireLease(id);
    const [currentClaim] = await reclaimExpiredQuotes(1, "worker-b");

    await expect(completeQuoteWithOutbox(staleClaim)).rejects.toThrow(
      "claim version 1 is stale",
    );
    expect(await outboxCountFor(id)).toBe(0);

    await completeQuoteWithOutbox(currentClaim);
    expect(await outboxCountFor(id)).toBe(1);
    expect(await statusOf(id)).toBe("COMPLETED");
  });
});

describe("markQuoteCompleted (PostgreSQL)", () => {
  it("completes a PROCESSING quote with the current claim", async () => {
    const [id] = await seedPendingQuotes(1);
    const [claim] = await claimPendingQuotes(1, "worker-a");

    expect((await markQuoteCompleted(claim))?.id).toBe(id);
    expect(await statusOf(id)).toBe("COMPLETED");
  });

  it.each(["PENDING", "COMPLETED", "FAILED", "REJECTED"] as const)(
    "refuses to complete a %s quote",
    async (status) => {
      const id = await seedQuote(status);

      expect(await markQuoteCompleted({ quoteId: id, version: 0 })).toBeNull();
      expect(await statusOf(id)).toBe(status);
    },
  );

  it.each([0, 2])(
    "refuses to complete a PROCESSING quote with non-matching version %i",
    async (version) => {
      const [id] = await seedPendingQuotes(1);
      await claimPendingQuotes(1, "worker-a");

      expect(await markQuoteCompleted({ quoteId: id, version })).toBeNull();
      expect(await statusOf(id)).toBe("PROCESSING");
    },
  );

  it("completes a claimed quote only once", async () => {
    const [id] = await seedPendingQuotes(1);
    const [claim] = await claimPendingQuotes(1, "worker-a");

    const results = await Promise.all([
      markQuoteCompleted(claim),
      markQuoteCompleted(claim),
    ]);

    expect(results.filter((quote) => quote !== null)).toHaveLength(1);
    expect(await statusOf(id)).toBe("COMPLETED");
  });
});
