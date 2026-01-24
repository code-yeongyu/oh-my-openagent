import type { CLIResponse } from './types.js';

/**
 * Create an ISO 8601 timestamp.
 *
 * @returns ISO 8601 formatted timestamp with milliseconds
 *
 * @example
 * ```typescript
 * const ts = createTimestamp(); // "2024-12-25T22:03:00.000Z"
 * ```
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a response envelope base.
 *
 * @param command - The command type
 * @param success - Whether the command succeeded
 * @returns Base CLIResponse object
 */
export function createResponseEnvelope(
  command: 'index' | 'select',
  success: boolean,
): Omit<CLIResponse, 'data'> {
  return {
    success,
    command,
    timestamp: createTimestamp(),
  };
}

/**
 * Remove null fields from an object.
 *
 * @param obj - The object to clean
 * @returns Object with null fields removed
 */
export function omitNullFields<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize a value for JSON serialization.
 *
 * Handles undefined, BigInt, circular references, and special values.
 *
 * @param value - The value to sanitize
 * @returns JSON-safe value
 */
export function sanitizeForJson(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return null;
  }

  return value;
}
