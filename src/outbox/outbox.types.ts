export type OutboxEvent = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
  published_at: Date | null;
};

export type NewOutboxEvent = {
  id?: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
};
