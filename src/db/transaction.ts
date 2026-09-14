import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { pool } from "../db.js";

export type DbClient = Pick<PoolClient, "query">;

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to roll back transaction:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow>(
  client: DbClient | undefined,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (client) {
    return client.query<T>(text, params);
  }
  return pool.query<T>(text, params);
}
