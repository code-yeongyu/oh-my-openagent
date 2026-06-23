export async function raceWithTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`dispatch timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([p, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
