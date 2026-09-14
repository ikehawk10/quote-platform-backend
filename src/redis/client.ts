import "dotenv/config";
import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function createRedisClient(): RedisClientType {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }

  const client: RedisClientType = createClient({ url });
  client.on("error", (error) => {
    console.error("Redis client error:", error);
  });
  return client;
}

export async function getRedis(): Promise<RedisClientType> {
  redisClient ??= createRedisClient();

  if (redisClient.isOpen) {
    return redisClient;
  }

  connectPromise ??= redisClient.connect().then(() => redisClient!);
  return connectPromise;
}
