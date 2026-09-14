import { NODE_INSTANCE_ID } from "../config/instance.js";
import { getRedis } from "../redis/client.js";

export const SSE_OWNERSHIP_TTL_SECONDS = 30;
export const SSE_OWNERSHIP_HEARTBEAT_MS = 10_000;

export function sseOwnershipKey(quoteId: string): string {
  return `sse:quote:${quoteId}`;
}

/**
 * Register this Node instance as the owner of SSE connections for a quote.
 * Overwrites any previous owner (newest connection wins for routing).
 */
export async function claimSseOwnership(quoteId: string): Promise<void> {
  const redis = await getRedis();
  await redis.set(sseOwnershipKey(quoteId), NODE_INSTANCE_ID, {
    EX: SSE_OWNERSHIP_TTL_SECONDS,
  });
}

/**
 * Refresh the ownership TTL only if this instance still owns the key.
 */
export async function refreshSseOwnership(quoteId: string): Promise<boolean> {
  const redis = await getRedis();
  const key = sseOwnershipKey(quoteId);

  const result = await redis.eval(
    `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      return 0
    `,
    {
      keys: [key],
      arguments: [NODE_INSTANCE_ID, String(SSE_OWNERSHIP_TTL_SECONDS)],
    },
  );

  return result === 1;
}

/**
 * Delete the ownership key only if this instance still owns it.
 * Prevents removing a newer instance's (or newer claim's) mapping.
 */
export async function releaseSseOwnership(quoteId: string): Promise<boolean> {
  const redis = await getRedis();
  const key = sseOwnershipKey(quoteId);

  const result = await redis.eval(
    `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `,
    {
      keys: [key],
      arguments: [NODE_INSTANCE_ID],
    },
  );

  return result === 1;
}
