import { z } from "zod"
import { AuditError, assistantSchema, wireSchema, type WireRecord } from "./contracts"
import type { Runtime } from "./runtime"
import { join } from "node:path"

type Waiter = { readonly matches: (record: WireRecord) => boolean; readonly resolve: (record: WireRecord) => void; readonly reject: (error: Error) => void; readonly timer: ReturnType<typeof setTimeout> }
export class Rpc implements AsyncDisposable {
  readonly records: WireRecord[] = []
  readonly command: readonly string[]
  readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">
  readonly stderr: Promise<string>
  private readonly waiters = new Set<Waiter>()
  private readonly reader: Promise<void>
  private failure: Error | undefined
  private sequence = 0
  constructor(readonly runtime: Runtime, readonly mode: "classic" | "multi", provider = "audit-local") {
    this.command = [runtime.binary, "--mode", "rpc", ...(mode === "multi" ? ["--multi-session"] : ["--no-session"]),
      "--no-extensions", "--extension", join(runtime.root, "fixtures/extension.ts"), "--no-skills", "--no-context-files", "--provider", provider, "--model", "audit-v1"]
    this.process = Bun.spawn([...this.command], { cwd: runtime.cwd, env: { ...runtime.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    this.stderr = new Response(this.process.stderr).text()
    this.reader = this.read()
  }
  private async read(): Promise<void> {
    let buffer = ""
    const decoder = new TextDecoder()
    try {
      for await (const chunk of this.process.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        let index: number
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (!line) continue
          const record = wireSchema.parse(JSON.parse(line))
          this.records.push(record)
          for (const waiter of this.waiters) {
            if (waiter.matches(record)) {
              clearTimeout(waiter.timer)
              this.waiters.delete(waiter)
              waiter.resolve(record)
            }
          }
        }
      }
      this.fail(new AuditError("rpc", "output stream closed"))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.fail(error)
    }
  }
  private fail(error: Error): void {
    this.failure = error
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error) }
    this.waiters.clear()
  }
  wait(matches: (record: WireRecord) => boolean): Promise<WireRecord> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new AuditError("rpc", "record deadline exceeded")) }, 45000)
      const waiter = { matches, resolve, reject, timer }
      this.waiters.add(waiter)
    })
  }
  async request(request: Readonly<Record<string, unknown>>): Promise<WireRecord> {
    const id = `audit-${++this.sequence}`
    const response = this.wait((record) => record.type === "response" && record.id === id)
    this.process.stdin.write(`${JSON.stringify({ ...request, id })}\n`)
    const record = await response
    if (record.success !== true) throw new AuditError(String(request.type), record.error ?? JSON.stringify(record))
    return record
  }
  async open(sessionPath: string, provider = "audit-local"): Promise<string> {
    const response = await this.request({ type: "open_session", sessionPath, cwd: this.runtime.cwd, provider, modelId: "audit-v1" })
    return z.object({ sessionId: z.string() }).parse(response.data).sessionId
  }
  async prompt(message: string, sessionId?: string) {
    const terminal = this.wait((record) => record.type === "message_end" && record.sessionId === sessionId && assistantSchema.safeParse(record.message).success)
    const settled = this.wait((record) => record.type === "agent_settled" && record.sessionId === sessionId)
    const [record] = await Promise.all([terminal, settled, this.request({ type: "prompt", message, ...(sessionId === undefined ? {} : { sessionId }) })])
    return assistantSchema.parse(record.message)
  }
  async extension(name: string, data: unknown, sessionId?: string): Promise<unknown> {
    return (await this.request({ type: "extension_request", name, data, ...(sessionId === undefined ? {} : { sessionId }) })).data
  }
  async [Symbol.asyncDispose](): Promise<void> {
    this.process.stdin.end()
    const timer = setTimeout(() => this.process.kill("SIGKILL"), 10000)
    try {
      const exitCode = await this.process.exited
      await this.reader
      const stderr = await this.stderr
      this.runtime.commands.push({ command: this.command, exitCode, stdout: "", stderr })
      if (exitCode !== 0) throw new AuditError("rpc teardown", `exit ${exitCode}: ${stderr}`)
    } finally { clearTimeout(timer) }
  }
}
