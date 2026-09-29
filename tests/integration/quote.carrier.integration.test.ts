import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulatedCarrierClient } from "../../src/carrier/carrier.simulated.js";
import { carrierIdempotencyKey, requestCarrierQuote } from "../../src/quotes/quote.carrier.js";
import { completeQuoteWithOutbox } from "../../src/quotes/quote.completion.js";
import {
  claimPendingQuotes,
  findQuoteById,
  reclaimExpiredQuotes,
  releaseQuoteClaim,
} from "../../src/quotes/quote.repository.js";
import type { QuoteClaim } from "../../src/quotes/quote.types.js";
import { processClaim, processPendingQuotes } from "../../src/quotes/quote.worker.js";
import {
  claimStateOf,
  expireLease,
  outboxCountFor,
  seedPendingQuotes,
  useTestDatabase,
} from "./helpers.js";

useTestDatabase();

/**
 * Worker A runs the same steps as processClaim (load quote, call carrier)
 * and then its process dies: nothing after the carrier call ever runs, so
 * there is no completion and no release.
 */
async function workerAClaimsCallsCarrierThenCrashes(
  carrier: SimulatedCarrierClient,
  quoteId: string,
): Promise<QuoteClaim> {
  const [claim] = await claimPendingQuotes(1, "worker-a");
  expect(claim.quoteId).toBe(quoteId);

  const quote = await findQuoteById(claim.quoteId);
  await requestCarrierQuote(carrier, quote!);

  return claim;
}

describe("carrier idempotency across worker crashes (PostgreSQL)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("carrier succeeds → worker crashes before DB update → lease expires → second worker retries with the same key", async () => {
    const carrier = new SimulatedCarrierClient();
    const [id] = await seedPendingQuotes(1);
    const key = carrierIdempotencyKey(id);

    // 1. Carrier succeeds, worker A crashes before touching the DB again.
    await workerAClaimsCallsCarrierThenCrashes(carrier, id);
    expect(carrier.executionCount).toBe(1);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: "worker-a",
      claim_version: 1,
    });

    // 2. While A's lease is live, worker B leaves the quote alone.
    expect(await processPendingQuotes(10, { carrier, workerId: "worker-b" })).toBe(0);
    expect(carrier.requests).toHaveLength(1);

    // 3. Lease expires; worker B reclaims and retries.
    await expireLease(id);
    expect(await processPendingQuotes(10, { carrier, workerId: "worker-b" })).toBe(1);

    // Both attempts sent the same key; the carrier did the work only once
    // and handed worker B the response worker A never got to persist.
    const [attemptA, attemptB] = carrier.requests;
    expect(attemptA.request.idempotencyKey).toBe(key);
    expect(attemptB.request.idempotencyKey).toBe(key);
    expect(attemptB.request).toEqual(attemptA.request);
    expect(attemptA.replayed).toBe(false);
    expect(attemptB.replayed).toBe(true);
    expect(attemptB.response).toEqual(attemptA.response);
    expect(carrier.executionCount).toBe(1);

    // The DB reflects exactly one completion, owned by worker B's claim.
    expect(await claimStateOf(id)).toMatchObject({
      status: "COMPLETED",
      claimed_by: "worker-b",
      claim_version: 2,
    });
    expect(await outboxCountFor(id)).toBe(1);
  });

  it("if worker A was only paused, it wakes up fenced out and cannot complete or release", async () => {
    const carrier = new SimulatedCarrierClient();
    const [id] = await seedPendingQuotes(1);

    const claimA = await workerAClaimsCallsCarrierThenCrashes(carrier, id);
    await expireLease(id);
    const [claimB] = await reclaimExpiredQuotes(1, "worker-b");

    // A resumes after B has taken over but before B finishes.
    await expect(completeQuoteWithOutbox(claimA)).rejects.toThrow(
      "claim version 1 is stale",
    );
    expect(await releaseQuoteClaim(claimA)).toBe(false);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PROCESSING",
      claimed_by: "worker-b",
      claim_version: 2,
    });

    // B finishes normally with a replayed carrier response.
    expect(await processClaim(claimB, carrier)).toBe(true);
    expect(carrier.executionCount).toBe(1);
    expect(await outboxCountFor(id)).toBe(1);

    // A trying again after B completed changes nothing.
    await expect(completeQuoteWithOutbox(claimA)).rejects.toThrow();
    expect(await outboxCountFor(id)).toBe(1);
  });

  it("carrier processes the request but the response is lost → release → retry replays instead of re-executing", async () => {
    const carrier = new SimulatedCarrierClient();
    const [id] = await seedPendingQuotes(1);
    carrier.dropNextResponse();

    expect(await processPendingQuotes(10, { carrier, workerId: "worker-a" })).toBe(0);
    expect(await claimStateOf(id)).toMatchObject({
      status: "PENDING",
      claim_version: 1,
    });

    expect(await processPendingQuotes(10, { carrier, workerId: "worker-b" })).toBe(1);

    expect(carrier.requests.map((r) => r.request.idempotencyKey)).toEqual([
      carrierIdempotencyKey(id),
      carrierIdempotencyKey(id),
    ]);
    expect(carrier.executionCount).toBe(1);
    expect(await claimStateOf(id)).toMatchObject({
      status: "COMPLETED",
      claim_version: 2,
    });
    expect(await outboxCountFor(id)).toBe(1);
  });

  it("the key stays the same across every claim version of a quote", async () => {
    const carrier = new SimulatedCarrierClient();
    const [id] = await seedPendingQuotes(1);

    await workerAClaimsCallsCarrierThenCrashes(carrier, id);
    await expireLease(id);
    const [claimB] = await reclaimExpiredQuotes(1, "worker-b");
    await requestCarrierQuote(carrier, (await findQuoteById(id))!);
    await expireLease(id);
    await processPendingQuotes(10, { carrier, workerId: "worker-c" });

    expect(claimB.version).toBe(2);
    expect((await claimStateOf(id)).claim_version).toBe(3);
    expect(new Set(carrier.requests.map((r) => r.request.idempotencyKey))).toEqual(
      new Set([carrierIdempotencyKey(id)]),
    );
    expect(carrier.executionCount).toBe(1);
  });

  it("concurrent workers over many quotes execute each quote at the carrier exactly once", async () => {
    const carrier = new SimulatedCarrierClient();
    const ids = await seedPendingQuotes(12);

    const results = await Promise.all(
      ["worker-a", "worker-b", "worker-c"].map((workerId) =>
        processPendingQuotes(5, { carrier, workerId }),
      ),
    );
    const sweep = await processPendingQuotes(100, { carrier, workerId: "worker-sweep" });

    expect(results.reduce((sum, n) => sum + n, sweep)).toBe(ids.length);
    expect(carrier.executionCount).toBe(ids.length);
    for (const id of ids) {
      expect((await claimStateOf(id)).status).toBe("COMPLETED");
      expect(await outboxCountFor(id)).toBe(1);
    }
  });
});
