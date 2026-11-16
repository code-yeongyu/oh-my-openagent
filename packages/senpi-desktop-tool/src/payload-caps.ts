/** Largest `computer` / `computer_actions` input accepted, as UTF-8 JSON bytes; larger input never starts anything. */
export const MAX_ARGUMENT_BYTES = 1024 * 1024
/** Largest helper return value handed back, as UTF-8 JSON bytes; a larger one is replaced by a failure. */
export const MAX_RESULT_BYTES = 8 * 1024 * 1024

function jsonBytes(value: unknown): number {
  return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
}

export function oversizeArguments(input: unknown): string | undefined {
  const size = jsonBytes(input)
  return size > MAX_ARGUMENT_BYTES
    ? `the call's arguments are ${size} bytes of JSON; the limit is ${MAX_ARGUMENT_BYTES}`
    : undefined
}

export function oversizeResult(value: unknown): string | undefined {
  const size = jsonBytes(value)
  return size > MAX_RESULT_BYTES
    ? `the helper's return value is ${size} bytes of JSON; the limit is ${MAX_RESULT_BYTES}`
    : undefined
}
