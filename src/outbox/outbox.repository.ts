import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/transaction.js";
import { query } from "../db/transaction.js";
import type { NewOutboxEvent, OutboxEvent } from "./outbox.types.js";

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
  published_at: Date | null;
};

function mapRow(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    aggregate_id: row.aggregate_id,
    payload: row.payload,
    created_at: row.created_at,
    published_at: row.published_at,
  };
}

export async function insertOutboxEvent(
  client: DbClient,
  input: NewOutboxEvent,
): Promise<OutboxEvent> {
  const id = input.id ?? randomUUID();
  const result = await query<OutboxRow>(
    client,
    `INSERT INTO outbox_events (id, event_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, event_type, aggregate_id, payload, created_at, published_at`,
    [id, input.event_type, input.aggregate_id, JSON.stringify(input.payload)],
  );

  return mapRow(result.rows[0]);
}

export async function findUnpublishedOutboxEvents(
  limit: number,
  client?: DbClient,
): Promise<OutboxEvent[]> {
  const result = await query<OutboxRow>(
    client,
    `SELECT id, event_type, aggregate_id, payload, created_at, published_at
     FROM outbox_events
     WHERE published_at IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map(mapRow);
}

export async function markOutboxEventPublished(
  id: string,
  client?: DbClient,
): Promise<OutboxEvent | null> {
  const result = await query<OutboxRow>(
    client,
    `UPDATE outbox_events
     SET published_at = now()
     WHERE id = $1 AND published_at IS NULL
     RETURNING id, event_type, aggregate_id, payload, created_at, published_at`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
