import type { Subprocess } from "bun"

// One native helper process: commands go in on stdin, one JSON object per line comes out on stdout. Control lines
// (`ctl`) are answered to waiters that subscribed before their trigger was sent; every other line is a sentinel event
// handed to the session's recording.

export type ControlLine = Readonly<Record<string, unknown>> & { readonly ctl: string }

const isControl = (value: unknown): value is ControlLine =>
  typeof value === "object" && value !== null && "ctl" in value && typeof value.ctl === "string"

export class Helper {
  readonly pid: number
  private readonly waiters = new Set<(line: ControlLine) => void>()
  private stderr = ""

  private constructor(
    readonly role: string,
    private readonly process: Subprocess<"pipe", "pipe", "pipe">,
    onEventLine: (line: string) => void,
  ) {
    this.pid = process.pid
    void this.pump(process.stdout, (line) => {
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        onEventLine(line)
        return
      }
      if (isControl(value)) for (const waiter of [...this.waiters]) waiter(value)
      else onEventLine(line)
    })
    void this.pump(process.stderr, (line) => {
      if (this.stderr.length < 4_096) this.stderr += `${line}\n`
    })
  }

  static spawn(role: string, command: readonly string[], onEventLine: (line: string) => void): Helper {
    const child = Bun.spawn([...command], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    return new Helper(role, child, onEventLine)
  }

  private async pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true })
      let newline = pending.indexOf("\n")
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        if (line !== "") onLine(line)
        newline = pending.indexOf("\n")
      }
    }
  }

  send(command: string): void {
    this.process.stdin.write(`${command}\n`)
    void this.process.stdin.flush()
  }

  /** Subscribe before triggering: the returned promise only sees lines that arrive after this call. */
  next(match: (line: ControlLine) => boolean, timeoutMs: number, what: string): Promise<ControlLine> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter)
        reject(new Error(`${this.role}: waited ${timeoutMs} ms for ${what}, never came${this.diagnostics()}`))
      }, timeoutMs)
      const waiter = (line: ControlLine): void => {
        if (!match(line)) return
        clearTimeout(timer)
        this.waiters.delete(waiter)
        resolve(line)
      }
      this.waiters.add(waiter)
    })
  }

  private diagnostics(): string {
    const exited = this.process.exitCode === null ? "" : ` (exited ${this.process.exitCode})`
    return `${exited}${this.stderr === "" ? "" : `; stderr: ${this.stderr.trim().slice(0, 600)}`}`
  }

  async stop(): Promise<void> {
    if (this.process.exitCode !== null) return
    this.send("quit")
    const quit = await Promise.race([this.process.exited.then(() => true), Bun.sleep(3_000).then(() => false)])
    if (!quit) {
      this.process.kill(9)
      await this.process.exited
    }
  }

  alive(): boolean {
    try {
      process.kill(this.pid, 0)
      return true
    } catch {
      return false
    }
  }
}
