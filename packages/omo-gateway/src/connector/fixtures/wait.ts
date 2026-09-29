// Line-based waits for connector tests. The connector reports every lifecycle step as a log line
// (lock held, listening, caught up, handed off, draining, stopped); tests subscribe to those lines
// from a child's stream or the in-process `log` callback instead of watching directories, whose
// change events the platform may drop under load. Every wait is bounded by a hung-process guard.

export const WAIT_MS = 60_000

export class LineCollector {
  readonly lines: string[] = []
  readonly ended: Promise<void>
  private finished = false
  private readonly waiters = new Set<() => void>()

  constructor(stream: ReadableStream<Uint8Array> | null = null) {
    this.ended = stream === null ? new Promise<void>(() => undefined) : this.pump(stream)
  }

  push(line: string): void {
    this.lines.push(line)
    for (const waiter of this.waiters) waiter()
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true })
      const parts = pending.split("\n")
      pending = parts.pop() ?? ""
      for (const part of parts) this.push(part)
    }
    if (pending !== "") this.push(pending)
    this.finished = true
    for (const waiter of this.waiters) waiter()
  }

  /** Resolves once `count` lines match `predicate`; rejects on the guard or when the stream ends short. */
  waitFor(predicate: (line: string) => boolean, count: number, label: string, timeoutMs = WAIT_MS): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const check = () => {
        const hits = this.lines.filter(predicate)
        if (hits.length >= count) done(hits)
        else if (this.finished) done(new Error(`stream ended with ${hits.length}/${count} ${label}; lines: ${JSON.stringify(this.lines)}`))
      }
      const timer = setTimeout(() => done(new Error(`timed out waiting for ${count} ${label}; lines: ${JSON.stringify(this.lines)}`)), timeoutMs)
      const done = (outcome: string[] | Error) => {
        clearTimeout(timer)
        this.waiters.delete(check)
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome)
      }
      this.waiters.add(check)
      check()
    })
  }
}
