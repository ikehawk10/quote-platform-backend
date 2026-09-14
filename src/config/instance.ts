import { randomUUID } from "node:crypto";

/**
 * Stable identifier for this Node process/instance.
 * Used as the Redis value for SSE ownership keys.
 */
export const NODE_INSTANCE_ID =
  process.env.NODE_INSTANCE_ID?.trim() || randomUUID();
