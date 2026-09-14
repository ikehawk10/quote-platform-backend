import type { Request, Response } from "express";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClaim,
  mockRefresh,
  mockRelease,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockRefresh: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock("../../src/quotes/quote.sseOwnership.js", () => ({
  claimSseOwnership: mockClaim,
  refreshSseOwnership: mockRefresh,
  releaseSseOwnership: mockRelease,
  SSE_OWNERSHIP_HEARTBEAT_MS: 10_000,
  SSE_OWNERSHIP_TTL_SECONDS: 30,
}));

import { openQuoteSseSession } from "../../src/quotes/quote.sseSession.js";
import { quoteSseHub } from "../../src/quotes/quote.sse.js";

function createMockReqRes() {
  const req = new EventEmitter() as Request;
  const writes: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
  }) as unknown as Response;

  return { req, res, writes };
}

describe("openQuoteSseSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(true);
    mockRelease.mockResolvedValue(true);
    quoteSseHub.clear();
  });

  afterEach(() => {
    quoteSseHub.clear();
    vi.clearAllTimers();
  });

  it("registers hub client, claims Redis ownership, and sends connected", async () => {
    const { req, res, writes } = createMockReqRes();

    const session = await openQuoteSseSession("quote-1", req, res);

    expect(session.quoteId).toBe("quote-1");
    expect(quoteSseHub.getClientCount("quote-1")).toBe(1);
    expect(mockClaim).toHaveBeenCalledWith("quote-1");
    expect(writes.join("")).toContain("event: connected");
    expect(writes.join("")).toContain('"quoteId":"quote-1"');
  });

  it("does not release Redis ownership while another local client remains", async () => {
    const first = createMockReqRes();
    const second = createMockReqRes();

    await openQuoteSseSession("quote-2", first.req, first.res);
    await openQuoteSseSession("quote-2", second.req, second.res);

    expect(quoteSseHub.getClientCount("quote-2")).toBe(2);

    first.req.emit("close");
    await Promise.resolve();

    expect(quoteSseHub.getClientCount("quote-2")).toBe(1);
    expect(mockRelease).not.toHaveBeenCalled();

    second.req.emit("close");
    await Promise.resolve();

    expect(quoteSseHub.getClientCount("quote-2")).toBe(0);
    expect(mockRelease).toHaveBeenCalledWith("quote-2");
  });

  it("rolls back the hub client if Redis claim fails", async () => {
    mockClaim.mockRejectedValue(new Error("redis down"));
    const { req, res } = createMockReqRes();

    await expect(openQuoteSseSession("quote-3", req, res)).rejects.toThrow(
      "redis down",
    );
    expect(quoteSseHub.getClientCount("quote-3")).toBe(0);
  });
});
