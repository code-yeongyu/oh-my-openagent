// The dedupe cursor: which inbound event ids this connector already handed to its sink, the
// newest event time it saw (the catch-up watermark), and the threads it has seen traffic in.
//
// It is persisted with writeFileAtomic after every sink hand-off, so a kill -9 leaves either the
// previous or the next state on disk, never a torn file. Order is sink first, cursor second: the
// only window a crash can hit re-emits that one event on restart (sinks key on `event_id`), it
// never loses one.

import { readFile, rename } from "@oh-my-opencode/memory-core/fs"
import type { InboundEvent, SurfaceKey } from "../adapter/contract"
import { writeFileAtomic } from "./lock"

export const SEEN_CAP = 5000
export const THREAD_CAP = 300
/** A fresh cursor starts this far in the past, so a first start still picks up the last few minutes. */
export const INITIAL_LOOKBACK_MS = 10 * 60_000
/** Catch-up reads from the watermark minus this overlap; dedupe absorbs the replayed part. */
export const CATCH_UP_OVERLAP_MS = 60_000

type Persisted = { since: string; seen: string[]; threads: SurfaceKey[] }

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function isSurfaceKey(value: unknown): value is SurfaceKey {
  if (value === null || typeof value !== "object") return false
  const threadId: unknown = Reflect.get(value, "thread_id")
  return (
    typeof Reflect.get(value, "platform") === "string" &&
    typeof Reflect.get(value, "account_id") === "string" &&
    typeof Reflect.get(value, "chat_id") === "string" &&
    (threadId === null || typeof threadId === "string")
  )
}

function parsePersisted(raw: string): Persisted | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== "object") return null
  const since: unknown = Reflect.get(value, "since")
  const seen: unknown = Reflect.get(value, "seen")
  const threads: unknown = Reflect.get(value, "threads")
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) return null
  if (!Array.isArray(seen) || !seen.every((id): id is string => typeof id === "string")) return null
  if (!Array.isArray(threads) || !threads.every(isSurfaceKey)) return null
  return { since, seen, threads }
}

const threadKey = (key: SurfaceKey): string => `${key.chat_id}\u0000${key.thread_id ?? ""}`

export class ConnectorCursor {
  private readonly seenIds: Set<string>
  private readonly seenOrder: string[]
  private readonly threadMap: Map<string, SurfaceKey>
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    readonly path: string,
    private since: string,
    seen: readonly string[],
    threads: readonly SurfaceKey[],
  ) {
    this.seenOrder = [...seen]
    this.seenIds = new Set(seen)
    this.threadMap = new Map(threads.map((key) => [threadKey(key), key]))
  }

  /**
   * Load the cursor at `path`. A missing file starts fresh; an unreadable one is moved aside to
   * `<path>.corrupt-<time>` (reported through `onCorrupt`) and starts fresh rather than blocking
   * the connector forever.
   */
  static async load(path: string, options: { now?: () => number; onCorrupt?: (movedTo: string) => void } = {}): Promise<ConnectorCursor> {
    const now = options.now ?? Date.now
    const fresh = () => new ConnectorCursor(path, new Date(now() - INITIAL_LOOKBACK_MS).toISOString(), [], [])
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return fresh()
      throw error
    }
    const persisted = parsePersisted(raw)
    if (persisted !== null) return new ConnectorCursor(path, persisted.since, persisted.seen, persisted.threads)
    const movedTo = `${path}.corrupt-${now()}`
    await rename(path, movedTo)
    options.onCorrupt?.(movedTo)
    return fresh()
  }

  get watermark(): string {
    return this.since
  }

  get seenCount(): number {
    return this.seenOrder.length
  }

  hasSeen(event_id: string): boolean {
    return this.seenIds.has(event_id)
  }

  /** Mark `event` handed off: its id joins the seen set, its time may advance the watermark. */
  record(event: InboundEvent): void {
    if (!this.seenIds.has(event.event_id)) {
      this.seenIds.add(event.event_id)
      this.seenOrder.push(event.event_id)
      while (this.seenOrder.length > SEEN_CAP) {
        const dropped = this.seenOrder.shift()
        if (dropped !== undefined) this.seenIds.delete(dropped)
      }
    }
    if (Date.parse(event.at) > Date.parse(this.since)) this.since = new Date(Date.parse(event.at)).toISOString()
    if (event.key.thread_id !== null) {
      const id = threadKey(event.key)
      this.threadMap.delete(id)
      this.threadMap.set(id, event.key)
      while (this.threadMap.size > THREAD_CAP) {
        const oldest = this.threadMap.keys().next()
        if (oldest.done === true) break
        this.threadMap.delete(oldest.value)
      }
    }
  }

  catchUpSince(): string {
    return new Date(Date.parse(this.since) - CATCH_UP_OVERLAP_MS).toISOString()
  }

  threads(): SurfaceKey[] {
    return [...this.threadMap.values()]
  }

  /** Persist atomically; concurrent calls are serialized so the newest state lands last. */
  save(): Promise<void> {
    const snapshot: Persisted = { since: this.since, seen: [...this.seenOrder], threads: this.threads() }
    const next = this.writing.then(() => writeFileAtomic(this.path, `${JSON.stringify(snapshot)}\n`))
    this.writing = next.catch(() => undefined)
    return next
  }
}
