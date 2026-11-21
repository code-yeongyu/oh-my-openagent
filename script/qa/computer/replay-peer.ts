// One engine process the replay drives: newline-delimited JSON requests in, replies queued out,
// with a per-message wait and a bounded close that kills an engine that does not exit.
import { describe, InputError, ROOT } from "./replay-case"

export const MESSAGE_TIMEOUT_MS = 10_000
const EXIT_TIMEOUT_MS = 5_000

export class Peer {
  readonly proc: Bun.Subprocess<"pipe", "pipe", "inherit">
  private readonly queue: unknown[] = []
  private readonly waiters: Array<(message: unknown) => void> = []
  private ended = false
  private readonly pumped: Promise<void>

  constructor(cmd: string[], env: Record<string, string>) {
    try {
      this.proc = Bun.spawn(cmd, { cwd: ROOT, env, stdin: "pipe", stdout: "pipe", stderr: "inherit" })
    } catch (error) {
      throw new InputError(`cannot spawn the engine ${cmd[0]}: ${describe(error)}`)
    }
    this.pumped = this.pump()
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of this.proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        this.push(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
      }
    }
    this.push(buffer)
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter(undefined)
  }

  private push(line: string): void {
    if (line.trim() === "") return
    let message: unknown = line
    try {
      message = JSON.parse(line)
    } catch {
      /* an unparsable line stays a string and mismatches */
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter(message)
    else this.queue.push(message)
  }

  send(message: unknown): void {
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`)
      this.proc.stdin.flush()
    } catch {
      /* the engine is gone: its missing replies are reported as mismatches */
    }
  }

  next(): Promise<unknown> {
    if (this.queue.length > 0 || this.ended) return Promise.resolve(this.queue.shift())
    return new Promise((done) => {
      const waiter = (message: unknown) => {
        clearTimeout(timer)
        done(message)
      }
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        done(undefined)
      }, MESSAGE_TIMEOUT_MS)
      this.waiters.push(waiter)
    })
  }

  async close(): Promise<unknown[]> {
    this.proc.stdin.end()
    let timer: Timer | undefined
    const deadline = new Promise<false>((done) => {
      timer = setTimeout(() => done(false), EXIT_TIMEOUT_MS)
    })
    const exited = await Promise.race([this.proc.exited.then(() => true), deadline])
    clearTimeout(timer)
    if (!exited) this.proc.kill("SIGKILL")
    await this.proc.exited
    await this.pumped
    return this.queue.splice(0)
  }
}
