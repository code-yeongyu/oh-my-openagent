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

  #compact(): void {
    let newestStatus: WatchItem | undefined
    for (const item of this.#items) {
      if (item.kind !== "records") continue
      item.records.forEach((record, index) => {
        const seq = item.seqs?.[index]
        if (record["type"] === "session_status") newestStatus = { kind: "records", attachId: item.attachId, records: [record], ...(seq === undefined ? {} : { seqs: [seq] }) }
      })
    }
    const others = this.#items.filter((item) => item.kind !== "records")
    // A queued snapshot or attach end already leads to a fresh read; otherwise one is forced.
    const readsAnyway = others.some((item) => item.kind !== "resync")
    const resync: readonly WatchItem[] = readsAnyway ? [] : [{ kind: "resync" }]
    this.#items = [...(newestStatus === undefined ? [] : [newestStatus]), ...others, ...resync]
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
