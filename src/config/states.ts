/** USPS state/territory codes used for request format validation. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

export type UsStateCode = (typeof US_STATE_CODES)[number];

/**
 * States where quoting is currently available.
 * Expand this list as coverage grows.
 */
export const SUPPORTED_STATES = new Set<UsStateCode>([
  "TX",
  "CA",
  "FL",
  "NY",
  "IL",
]);

export function isSupportedState(state: string): state is UsStateCode {
  return SUPPORTED_STATES.has(state as UsStateCode);
}

export function unsupportedStateReason(state: string): string {
  return `State '${state}' is not currently supported`;
}
