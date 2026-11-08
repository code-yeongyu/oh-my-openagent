import type { JsonObject } from "./ports"

export type WatchItem =
  | { readonly kind: "records"; readonly attachId: number; readonly records: readonly JsonObject[]; readonly seqs?: readonly number[] }
  | { readonly kind: "snapshot"; readonly attachId: number }
  | { readonly kind: "resync" }
  | { readonly kind: "ended"; readonly reason: string }

// The attach listener runs inside the connection's data handler and only enqueues; past this many queued records the
// content is dropped (the newest session_status kept) and the session is read fresh instead, so a backlog costs detail,
// never a turn end.
const WATCH_QUEUE_MAX = 256

export class WatchQueue {
  #items: WatchItem[] = []
  #records = 0
  #scheduled = false
  #draining = false
  #closed = false

  constructor(readonly process: (item: WatchItem) => Promise<void>) {}

  push(item: WatchItem): void {
    if (this.#closed) return
    this.#items.push(item)
    if (item.kind === "records") this.#records += item.records.length
    if (this.#records > WATCH_QUEUE_MAX) this.#compact()
    if (this.#scheduled) return
    this.#scheduled = true
    void Promise.resolve().then(() => {
      this.#scheduled = false
      return this.#drain()
    })
  }

  close(): void {
    this.#closed = true
    this.#items = []
    this.#records = 0
  }

  // Drops every queued record but the newest session_status and keeps the order of what is left: a snapshot or attach end
  // queued before that record is still processed before it. A queued read (a snapshot or a resync) is processed after
  // every dropped record arrived, so it covers them; otherwise one is forced (an attach end may resume, with no read).
  #compact(): void {
    let newestStatus: { readonly at: number; readonly item: WatchItem } | undefined
    this.#items.forEach((item, at) => {
      if (item.kind !== "records") return
      item.records.forEach((record, index) => {
        const seq = item.seqs?.[index]
        if (record["type"] === "session_status") newestStatus = { at, item: { kind: "records", attachId: item.attachId, records: [record], ...(seq === undefined ? {} : { seqs: [seq] }) } }
      })
    })
    const kept = this.#items.flatMap((item, at) => (item.kind !== "records" ? [item] : newestStatus?.at === at ? [newestStatus.item] : []))
    const readsAnyway = kept.some((item) => item.kind === "snapshot" || item.kind === "resync")
    this.#items = readsAnyway ? kept : [...kept, { kind: "resync" }]
    this.#records = newestStatus === undefined ? 0 : 1
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      for (let item = this.#items.shift(); item !== undefined && !this.#closed; item = this.#items.shift()) {
        if (item.kind === "records") this.#records -= item.records.length
        await this.process(item)
      }
    } finally {
      this.#draining = false
    }
  }
}
