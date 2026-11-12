import type { DesktopSnapshot } from "../observation.ts"
import { parseEvents, type SentinelEvent } from "../summary.ts"
import { type ControlLine, Helper } from "./helper.ts"

// A recording session on a macOS QA desktop: the typist (the synthetic user), the recorder watching it, and for the
// self-test the planter plus an idle app to activate. `segment` cuts one judged trial out of the continuous recording.

export type HelperPaths = { readonly recorder: string; readonly typist: string; readonly planter: string }

type SessionOptions = {
  readonly helpers: HelperPaths
  readonly targetPids: readonly number[]
  readonly withPlanter: boolean
  readonly drop?: string
  readonly beforeTypist?: () => Promise<void>
}

const HELLO_MS = 15_000
const MARKER_MS = 3_000
const KEYSTROKE_MS = 2_500
// After a keystroke is posted, the final field read waits this long so the keystroke has landed.
const LANDING_MS = 400

const numberField = (line: ControlLine, field: string): number => {
  const value = line[field]
  if (typeof value !== "number") throw new Error(`${line.ctl} line has no numeric ${field}: ${JSON.stringify(line)}`)
  return value
}

export class MacSession {
  readonly events: SentinelEvent[] = []
  private readonly protocolFaults: string[] = []
  private readonly eventWaiters = new Set<(event: SentinelEvent) => void>()
  private readonly helpers: Helper[] = []
  recorder: Helper | undefined
  typist: Helper | undefined
  planter: Helper | undefined
  typistPid = 0
  typistWindow = 0
  idlePid = 0

  private record = (line: string): void => {
    const parsed = parseEvents(line)
    this.protocolFaults.push(...parsed.faults)
    for (const event of parsed.events) {
      this.events.push(event)
      for (const waiter of [...this.eventWaiters]) waiter(event)
    }
  }

  private async start(role: string, command: readonly string[], ready = "hello"): Promise<[Helper, ControlLine]> {
    const helper = Helper.spawn(role, command, this.record)
    const hello = helper.next((line) => line.ctl === ready, HELLO_MS, `its ${ready} line`)
    this.helpers.push(helper)
    return [helper, await hello]
  }

  static async open(options: SessionOptions): Promise<MacSession> {
    const session = new MacSession()
    try {
      if (options.withPlanter) {
        const [planter] = await session.start("planter", [options.helpers.planter])
        session.planter = planter
        const [, idle] = await session.start("idle", [options.helpers.planter, "--idle"])
        session.idlePid = numberField(idle, "pid")
      }
      await options.beforeTypist?.()
      const [typist, hello] = await session.start("typist", [options.helpers.typist])
      if (hello.frontmost !== true) throw new Error("typist could not become the frontmost app; no synthetic user")
      session.typist = typist
      session.typistPid = numberField(hello, "pid")
      session.typistWindow = numberField(hello, "window")
      const args = ["--user-pid", String(session.typistPid), "--target-pid", options.targetPids.join(",")]
      if (options.drop !== undefined) args.push("--drop", options.drop)
      const [recorder] = await session.start("recorder", [options.helpers.recorder, ...args], "ready")
      session.recorder = recorder
      return session
    } catch (error) {
      await session.close()
      throw error
    }
  }

  nextEvent(match: (event: SentinelEvent) => boolean, timeoutMs: number, what: string): Promise<SentinelEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters.delete(waiter)
        reject(new Error(`waited ${timeoutMs} ms for ${what}, never came`))
      }, timeoutMs)
      const waiter = (event: SentinelEvent): void => {
        if (!match(event)) return
        clearTimeout(timer)
        this.eventWaiters.delete(waiter)
        resolve(event)
      }
      this.eventWaiters.add(waiter)
    })
  }

  private need(helper: Helper | undefined, role: string): Helper {
    if (helper === undefined) throw new Error(`session has no ${role}`)
    return helper
  }

  async segment(act: () => Promise<void>, windowMs: number): Promise<SentinelEvent[]> {
    const recorder = this.need(this.recorder, "recorder")
    const typist = this.need(this.typist, "typist")
    const reset = typist.next((line) => line.ctl === "reset", MARKER_MS, "typist reset")
    typist.send("reset")
    await reset
    const firstKey = this.nextEvent((event) => event.kind === "typed" && event.index === 0, KEYSTROKE_MS, "first keystroke")
    typist.send("type")
    await firstKey
    await Bun.sleep(LANDING_MS)

    const started = this.nextEvent((event) => event.kind === "start", MARKER_MS, "recorder start marker")
    recorder.send("start")
    const start = await started
    await act()
    await Bun.sleep(windowMs)

    await this.nextEvent((event) => event.kind === "typed", KEYSTROKE_MS, "a keystroke after the window")
    await Bun.sleep(LANDING_MS)
    const stopped = this.nextEvent((event) => event.kind === "stop", MARKER_MS, "recorder stop marker")
    const finalRead = this.nextEvent((event) => event.kind === "field" && event.final, MARKER_MS, "final field read")
    recorder.send("stop")
    recorder.send("final")
    const [stop, final] = await Promise.all([stopped, finalRead])

    if (this.protocolFaults.length > 0) throw new Error(`helper protocol broken: ${this.protocolFaults.join("; ")}`)
    const ours = new Set<SentinelEvent>([start, stop, final])
    return this.events.filter((event) => {
      if (event.t > final.t) return false
      if (event.kind === "start" || event.kind === "stop") return ours.has(event)
      if (event.kind === "field" && event.final) return ours.has(event)
      return true
    })
  }

  async snapshot(): Promise<DesktopSnapshot> {
    const recorder = this.need(this.recorder, "recorder")
    const reply = recorder.next((line) => line.ctl === "snapshot", MARKER_MS, "desktop snapshot")
    recorder.send("snapshot")
    const line = await reply
    const pointer = line.pointer
    const order = line.order
    if (typeof pointer !== "object" || pointer === null || !("x" in pointer) || !("y" in pointer))
      throw new Error(`snapshot has no pointer: ${JSON.stringify(line)}`)
    if (!Array.isArray(order) || typeof line.focused !== "string") throw new Error(`malformed snapshot: ${JSON.stringify(line)}`)
    return {
      frontmostPid: numberField(line, "frontmostPid"),
      focused: line.focused,
      order: order.map(String),
      pointer: { x: Number(pointer.x), y: Number(pointer.y) },
    }
  }

  async close(): Promise<string[]> {
    await Promise.all(this.helpers.map((helper) => helper.stop()))
    const alive = this.helpers.filter((helper) => helper.alive())
    return [`procs ${alive.length}${alive.length === 0 ? "" : ` (${alive.map((helper) => helper.role).join(",")})`}`]
  }
}
