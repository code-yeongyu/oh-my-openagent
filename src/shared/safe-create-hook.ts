import { log } from "./logger"

interface SafeCreateHookOptions {
  enabled?: boolean
}

export function safeCreateHook<T>(
  name: string,
  factory: () => T,
  options?: SafeCreateHookOptions,
): T | null {
  const enabled = options?.enabled ?? true

  if (!enabled) {
    return factory() ?? null
  }

  try {
    return factory() ?? null
  } catch (error) {
    log(`[safe-create-hook] Hook creation failed: ${name}`, { error })
    return null
  }
}
