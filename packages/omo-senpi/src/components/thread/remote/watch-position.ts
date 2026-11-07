import type { AttachResume } from "@oh-my-opencode/device-service-core"

/**
 * Where a watch stands in its attach's record stream: the attach_id it is positioned on and the last record seq it
 * applied (seqs increase within an attach_id, with gaps). It drops a repeated record and names the point a drop resumes
 * from (relay daemon #774), once the attach is known to send seqs.
 */
export class WatchPosition {
  #attachId: number | undefined
  #lastSeq = 0
  #seqs = false

  get attachId(): number | undefined {
    return this.#attachId
  }

  /** On an attach's snapshot (`undefined`: before the next one): a new stream, nothing applied on it yet. */
  reset(attachId: number | undefined): void {
    this.#attachId = attachId
    this.#lastSeq = 0
  }

  sendsSeqs(seqs: boolean): void {
    this.#seqs = seqs
  }

  /** Replayed records only position the watch: they count as applied. */
  pass(seqs: readonly number[] | undefined): void {
    this.#lastSeq = Math.max(this.#lastSeq, ...(seqs ?? []))
  }

  /** Whether a record is new: not a repeat of one already applied on its attach_id (one with no seq always is). */
  admit(attachId: number, seq: number | undefined): boolean {
    if (attachId !== this.#attachId) this.reset(attachId)
    if (seq === undefined) return true
    if (seq <= this.#lastSeq) return false
    this.#lastSeq = seq
    return true
  }

  resumePoint(): AttachResume | undefined {
    return this.#seqs && this.#attachId !== undefined ? { attach_id: this.#attachId, seq: this.#lastSeq } : undefined
  }

  /** Whether an attach's taken `resume` serves `asked`: only records after a seq at or before the last one applied. */
  static serves(taken: AttachResume | undefined, asked: AttachResume | undefined): boolean {
    return asked !== undefined && taken !== undefined && taken.attach_id === asked.attach_id && taken.seq <= asked.seq
  }
}
