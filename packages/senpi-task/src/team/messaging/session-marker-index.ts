import { open, stat } from "node:fs/promises"

// Reads the byte range [start, end) of a session JSONL file. Injectable so tests can count bytes.
export type SessionSliceReader = (path: string, start: number, end: number) => Promise<string>

// Incremental index over a lead's append-only session JSONL. The lead poller must check, many times
// per tick, whether a peer-message envelope for a given messageId has been persisted. The naive check
// re-read + re-split the ENTIRE file on every call (O(pending x fileSize) per tick). This index keeps
// a per-path byte offset and the set of messageIds already seen, so each check reads only the bytes
// appended since the last check (and reads NOTHING when the file has not grown).
export type SessionMarkerIndex = {
  contains(path: string | undefined, messageId: string): Promise<boolean>
}

type PathState = { offset: number; residual: string; readonly seen: Set<string> }

// messageId="..." inside a persisted peer_message envelope. The envelope lives inside JSON-encoded
// strings, so the quote before the id may be a raw " or an escaped \". Match both.
const MESSAGE_ID_MARKER = /<peer_message [^>]*?messageId=\\?"([^"\\]+)\\?"/g

export function createSessionMarkerIndex(readSlice: SessionSliceReader = defaultReadSlice): SessionMarkerIndex {
  const states = new Map<string, PathState>()

  async function refresh(path: string): Promise<Set<string> | null> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch (error) {
      if (isMissingPath(error)) return null
      throw error
    }

    let state = states.get(path)
    if (state === undefined || size < state.offset) {
      // First sight, or the file shrank (rotation/truncation): start clean and rescan from zero.
      state = { offset: 0, residual: "", seen: new Set<string>() }
      states.set(path, state)
    }
    if (size === state.offset) return state.seen

    const chunk = await readSlice(path, state.offset, size)
    state.offset = size
    const text = state.residual + chunk
    const lastNewline = text.lastIndexOf("\n")
    const complete = lastNewline < 0 ? "" : text.slice(0, lastNewline + 1)
    state.residual = lastNewline < 0 ? text : text.slice(lastNewline + 1)
    for (const id of extractMessageIds(complete)) state.seen.add(id)
    return state.seen
  }

  return {
    async contains(path, messageId) {
      if (path === undefined) return false
      const seen = await refresh(path)
      return seen !== null && seen.has(messageId)
    },
  }
}

function extractMessageIds(text: string): string[] {
  const ids: string[] = []
  MESSAGE_ID_MARKER.lastIndex = 0
  let match = MESSAGE_ID_MARKER.exec(text)
  while (match !== null) {
    const id = match[1]
    if (id !== undefined) ids.push(id)
    match = MESSAGE_ID_MARKER.exec(text)
  }
  return ids
}

async function defaultReadSlice(path: string, start: number, end: number): Promise<string> {
  const length = end - start
  if (length <= 0) return ""
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.toString("utf8", 0, bytesRead)
  } finally {
    await handle.close()
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
