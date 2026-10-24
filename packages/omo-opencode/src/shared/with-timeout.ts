/** Races `operation` against a timer that rejects with `message`; a non-positive timeout disables it. */
export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return operation
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutID !== undefined) clearTimeout(timeoutID)
  })
}
