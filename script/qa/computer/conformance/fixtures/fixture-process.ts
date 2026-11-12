import { readFileSync } from "node:fs"
import { type FixtureReport, readFixtureReport } from "./fixture-report.ts"

const LINE_DEADLINE_MS = 30_000

export class FixtureProcess {
  private readonly lines: string[] = []
  private readonly waiters: Array<() => void> = []
  private ended = false

  private constructor(
    private readonly child: Bun.Subprocess<"pipe", "pipe", "inherit">,
    private readonly reportPath: string,
  ) {
    void this.pump()
  }

  static async start(command: readonly string[], reportPath: string, sabotage: string): Promise<FixtureProcess> {
    const env = { ...process.env, CONFORMANCE_FIXTURE_SABOTAGE: sabotage }
    const child = Bun.spawn([...command, "--report", reportPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env,
    })
    const fixture = new FixtureProcess(child, reportPath)
    await fixture.expect((line) => line.startsWith("READY pid="))
    return fixture
  }

  report(): FixtureReport {
    return readFixtureReport(this.reportPath)
  }

  reportText(): string {
    return readFileSync(this.reportPath, "utf8")
  }

  async send(line: string): Promise<void> {
    this.child.stdin.write(`${line}\n`)
    this.child.stdin.flush()
    const answer = await this.expect((received) => received === `OK ${line}` || received.startsWith("ERR "))
    if (answer !== `OK ${line}`) throw new Error(`fixture answered ${JSON.stringify(answer)} to ${JSON.stringify(line)}`)
  }

  async stop(): Promise<void> {
    if (!this.ended) {
      this.child.stdin.write("quit\n")
      this.child.stdin.end()
    }
    const deadline = Promise.withResolvers<"deadline">()
    const timer = setTimeout(() => deadline.resolve("deadline"), LINE_DEADLINE_MS)
    const exited = await Promise.race([this.child.exited, deadline.promise])
    clearTimeout(timer)
    if (exited === "deadline") {
      this.child.kill("SIGKILL")
      await this.child.exited
      throw new Error(`fixture did not exit within ${LINE_DEADLINE_MS} ms of quit`)
    }
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of this.child.stdout) {
      pending += decoder.decode(chunk, { stream: true })
      const parts = pending.split("\n")
      pending = parts.pop() ?? ""
      this.lines.push(...parts)
      this.wake()
    }
    this.ended = true
    this.wake()
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }

  private async expect(matches: (line: string) => boolean): Promise<string> {
    const deadline = Date.now() + LINE_DEADLINE_MS
    for (;;) {
      const index = this.lines.findIndex(matches)
      if (index >= 0) return this.lines.splice(0, index + 1)[index] ?? ""
      if (this.ended) throw new Error("fixture closed its output before the expected line")
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`no expected line from the fixture within ${LINE_DEADLINE_MS} ms`)
      const { promise, resolve } = Promise.withResolvers<void>()
      this.waiters.push(resolve)
      const timer = setTimeout(resolve, left)
      await promise
      clearTimeout(timer)
    }
  }
}
