export const DEFAULT_WAIT_FOR_TIMEOUT_MS: number
export function driveInput(
  page: unknown,
  inputs: readonly string[],
  keyDelayMs: number,
  options?: { readonly waitForTimeoutMs?: number },
): Promise<void>
