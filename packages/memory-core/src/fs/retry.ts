export const EINTR_RETRY_CAP = 128

export function fsErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export async function retryOnEintr<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (fsErrorCode(error) !== "EINTR" || attempt >= EINTR_RETRY_CAP) throw error
    }
  }
}

export function retryOnEintrSync<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      if (fsErrorCode(error) !== "EINTR" || attempt >= EINTR_RETRY_CAP) throw error
    }
  }
}
