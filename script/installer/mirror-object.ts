import type { R2Store } from "./r2-store"

export async function sha256Object(
  store: Pick<R2Store, "stream">,
  key: string,
  deadline: AbortSignal = AbortSignal.timeout(5 * 60_000),
): Promise<{ readonly sha256: string; readonly size: number }> {
  const hasher = new Bun.CryptoHasher("sha256")
  let size = 0
  try {
    await store.stream(key).pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          hasher.update(chunk)
          size += chunk.byteLength
        },
      }),
      { signal: deadline },
    )
    deadline.throwIfAborted()
  } catch (cause) {
    if (deadline.aborted)
      throw new Error(`Timed out reading ${key}; rerun installer-mirror for the same tag and channel.`, { cause })
    throw cause
  }
  return { sha256: hasher.digest("hex"), size }
}
