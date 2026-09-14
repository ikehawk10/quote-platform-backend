import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetRedis, mockEval, mockSet } = vi.hoisted(() => {
  const mockEval = vi.fn();
  const mockSet = vi.fn();
  const mockGetRedis = vi.fn(async () => ({
    set: mockSet,
    eval: mockEval,
  }));

  return { mockGetRedis, mockEval, mockSet };
});

vi.mock("../../src/redis/client.js", () => ({
  getRedis: mockGetRedis,
}));

vi.mock("../../src/config/instance.js", () => ({
  NODE_INSTANCE_ID: "instance-test-1",
}));

import {
  claimSseOwnership,
  refreshSseOwnership,
  releaseSseOwnership,
  SSE_OWNERSHIP_TTL_SECONDS,
  sseOwnershipKey,
} from "../../src/quotes/quote.sseOwnership.js";

describe("quote.sseOwnership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the ownership key as sse:quote:{quoteId}", () => {
    expect(sseOwnershipKey("abc")).toBe("sse:quote:abc");
  });

  it("claims ownership with this instance id and a TTL", async () => {
    mockSet.mockResolvedValue("OK");

    await claimSseOwnership("quote-1");

    expect(mockSet).toHaveBeenCalledWith("sse:quote:quote-1", "instance-test-1", {
      EX: SSE_OWNERSHIP_TTL_SECONDS,
    });
  });

  it("refreshes TTL only when this instance still owns the key", async () => {
    mockEval.mockResolvedValue(1);

    await expect(refreshSseOwnership("quote-1")).resolves.toBe(true);
    expect(mockEval).toHaveBeenCalledWith(expect.any(String), {
      keys: ["sse:quote:quote-1"],
      arguments: ["instance-test-1", String(SSE_OWNERSHIP_TTL_SECONDS)],
    });
  });

  it("releases ownership only when this instance still owns the key", async () => {
    mockEval.mockResolvedValue(1);

    await expect(releaseSseOwnership("quote-1")).resolves.toBe(true);
    expect(mockEval).toHaveBeenCalledWith(expect.any(String), {
      keys: ["sse:quote:quote-1"],
      arguments: ["instance-test-1"],
    });
  });

  it("does not report release success when another owner holds the key", async () => {
    mockEval.mockResolvedValue(0);

    await expect(releaseSseOwnership("quote-1")).resolves.toBe(false);
  });
});
