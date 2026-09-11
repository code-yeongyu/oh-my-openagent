// Stateful write paths. Whole-call retry is UNSAFE for multi-syscall writes: an EINTR from a
// later write(2) can arrive after earlier chunks already transferred, so replaying the whole
// writeFile/appendFile would duplicate data (append) or write at an advanced offset (handle).
// POSIX only guarantees no-transfer for the single interrupted write(2), so retry happens at
// exactly that boundary while tracked offsets carry the progress forward.

import { Buffer } from "node:buffer"
import { constants } from "node:fs"
import type * as fsSync from "node:fs"
import * as fsp from "node:fs/promises"

import { fsErrorCode, retryOnEintr, retryOnEintrSync } from "./retry"

export interface WritableHandle {
  write(buffer: Uint8Array, offset?: number): Promise<{ readonly bytesWritten: number }>
}

// Exclusive creates are ambiguous under EINTR (the file may exist afterwards), so they get
// exactly one attempt and the owning protocol recovers; shareable opens retry freely.
export function openSyncWithExclusivePolicy<Mode, Result>(
  rawOpen: (path: fsSync.PathLike, flags: fsSync.OpenMode, mode?: Mode) => Result,
  path: fsSync.PathLike,
  flags: fsSync.OpenMode,
  mode?: Mode,
): Result {
  if (isExclusiveFlag(flags)) return rawOpen(path, flags, mode)
  return retryOnEintrSync(() => rawOpen(path, flags, mode))
}

export function isExclusiveFlag(flag: string | number | undefined): boolean {
  if (typeof flag === "number") return (flag & constants.O_EXCL) !== 0
  return typeof flag === "string" && flag.toLowerCase().includes("x")
}

export async function writeHandleAll(
  handle: WritableHandle,
  data: string | Uint8Array,
  encoding?: BufferEncoding,
  signal?: AbortSignal,
): Promise<void> {
  const buffer = typeof data === "string" ? Buffer.from(data, encoding ?? "utf8") : data
  let offset = 0
  while (offset < buffer.length) {
    signal?.throwIfAborted()
    const { bytesWritten } = await retryOnEintr(() => handle.write(buffer, offset))
    if (bytesWritten <= 0) throw new Error(`fs write made no progress at offset ${offset}`)
    offset += bytesWritten
  }
}

type PathWriteOptions =
  | BufferEncoding
  | {
      readonly encoding?: BufferEncoding | null
      readonly mode?: string | number
      readonly flag?: string | number
      readonly flush?: boolean
      readonly signal?: AbortSignal
    }
  | null
  | undefined

export async function writePathAll(
  path: Parameters<typeof fsp.open>[0],
  data: string | Uint8Array,
  options: PathWriteOptions,
  defaultFlag: string,
): Promise<void> {
  const parsed = typeof options === "string" ? { encoding: options } : (options ?? {})
  parsed.signal?.throwIfAborted()
  const flag = parsed.flag ?? defaultFlag
  const openOnce = (): Promise<fsp.FileHandle> => fsp.open(path, flag, parsed.mode)
  // Exclusive creates are ambiguous under EINTR (the file may exist afterwards), so the
  // protocol owning that pathname handles recovery; only shareable opens are retried here.
  const handle = await (isExclusiveFlag(flag) ? openOnce() : retryOnEintr(openOnce))
  try {
    await writeHandleAll(handle, data, parsed.encoding ?? "utf8", parsed.signal)
    if (parsed.flush === true) await retryOnEintr(() => handle.sync())
  } finally {
    await handle.close().catch((error: unknown) => {
      if (fsErrorCode(error) !== "EINTR") throw error
    })
  }
}
