import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { helper, type Json, run, short, until } from "./hosted-macos-live-host.ts"
import type { Verdict } from "./hosted-macos-live-ledger.ts"

// Probe validity: a negative (CONTRADICTS) is recorded only when the OS answered the call and a positive control in
// the same run shows the oracle works; an errored call or a failed control is UNMEASURED, never a negative.

export type Answer = { readonly verdict: Verdict; readonly evidence: string }

export type Fixture = {
  readonly pid: number
  readonly windowNumber: number
  readonly x: number
  readonly y: number
  readonly stateFile: string
  readonly eventFile: string
}

export type Invoke = (args: readonly string[], timeoutMs?: number) => Json

export type Probe = {
  readonly invoke: Invoke
  readonly control: Invoke
  readonly fixture: Fixture
  readonly textEditPid: number | null
  readonly scratch: string
  readonly settleMs: number
}

const PROBE_KEYCODE = "80"
const PROBE_TAG = "7302511"

export function directInvoke(binary: string): Invoke {
  return (args, timeoutMs) => helper(binary, args, timeoutMs)
}

export function disclaimedInvoke(binary: string, subject: string): Invoke {
  return (args, timeoutMs) => helper(binary, ["disclaim", subject, ...args], timeoutMs)
}

const confirms = (evidence: string): Answer => ({ verdict: "CONFIRMS", evidence })
const contradicts = (evidence: string): Answer => ({ verdict: "CONTRADICTS", evidence })
const unmeasured = (evidence: string): Answer => ({ verdict: "UNMEASURED", evidence })

function failed(read: Json): string | null {
  return typeof read.helperError === "string" ? `helper call failed: ${read.helperError}` : null
}

function numberField(record: unknown, key: string): number {
  if (typeof record !== "object" || record === null || !(key in record)) return 0
  const value: unknown = Reflect.get(record, key)
  return typeof value === "number" ? value : 0
}

function commandOf(pid: unknown): string {
  return typeof pid === "number" && pid > 0 ? run("/bin/ps", ["-o", "comm=", "-p", String(pid)]).stdout : "unknown"
}

export function askTrusted(probe: Probe): Answer {
  const read = probe.invoke(["trusted"])
  const error = failed(read)
  if (error !== null) return unmeasured(error)
  const evidence = `${short(read)} responsible=${commandOf(read.responsiblePid)}`
  return read.axTrusted === true ? confirms(evidence) : contradicts(`AXIsProcessTrusted answered false: ${evidence}`)
}

export async function askAxTree(probe: Probe): Promise<Answer> {
  if (probe.textEditPid === null) return unmeasured("TextEdit did not start, so there was no window to read")
  const pid = String(probe.textEditPid)
  const tree = await until(
    () => probe.invoke(["ax-tree", pid]),
    (read) => numberField(read, "windows") > 0,
    10_000,
  )
  const error = failed(tree)
  if (error !== null) return unmeasured(error)
  const hasTextArea = numberField(tree.roles, "AXTextArea") > 0
  if (numberField(tree, "nodes") >= 3 && hasTextArea) return confirms(`TextEdit tree ${short(tree)}`)
  const control = probe.control(["dialogs", "TextEdit"])
  const windowListed = Array.isArray(control.windows) && control.windows.length > 0
  if (!windowListed) return unmeasured(`control failed: no TextEdit window in the window list ${short(control)}`)
  return contradicts(`TextEdit window is listed (${short(control)}) but the AX read gave ${short(tree)}`)
}

function stateLines(file: string): string[] {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : []
}

async function nextState(file: string, before: number, settleMs: number): Promise<string | undefined> {
  const lines = await until(
    () => stateLines(file),
    (read) => read.length > before,
    settleMs,
  )
  return lines.length > before ? lines.at(-1) : undefined
}

const PID_ROUTES = [
  ["cg", "CGEventPostToPid"],
  ["sl", "SLEventPostToPid"],
] as const

function frameOf(read: Json): readonly number[] | null {
  const frame = read.frame
  if (!Array.isArray(frame) || frame.length !== 4) return null
  const numbers = frame.filter((value): value is number => typeof value === "number")
  return numbers.length === 4 ? numbers : null
}

type ClickResult = { readonly toggled: string | undefined; readonly note: string }

async function clickAt(probe: Probe, aim: readonly string[], route: string): Promise<ClickResult | string> {
  const { fixture } = probe
  const before = stateLines(fixture.stateFile).length
  const eventsBefore = stateLines(fixture.eventFile).length
  const click = probe.invoke(["click", String(fixture.pid), String(fixture.windowNumber), ...aim, route])
  const error = failed(click)
  if (error !== null) return error
  const toggled = await nextState(fixture.stateFile, before, probe.settleMs)
  const delivered = stateLines(fixture.eventFile).slice(eventsBefore)
  const arrival =
    delivered.length === 0
      ? "the fixture window received no mouse event"
      : `the fixture window received ${short(delivered)}`
  return {
    toggled,
    note: `${route}: ${toggled === undefined ? "no toggle" : `toggled ${toggled}`} after ${short(click)}; ${arrival}`,
  }
}

async function frontmost(probe: Probe, pid: string): Promise<string | null> {
  if (probe.control(["frontmost", pid]).frontmost === true) return null
  const activated = probe.control(["activate", pid])
  const again = probe.control(["frontmost", pid])
  return again.frontmost === true ? null : `fixture is not frontmost after activate ${short(activated)}`
}

function provenAim(probe: Probe, frame: readonly number[]): readonly string[] | string {
  const [left = 0, top = 0, width = 0, height = 0] = frame
  const middle = top + height / 2
  const candidates = [
    [left + width / 2, middle],
    [left + Math.min(height / 2, 10), middle],
  ]
  const misses: string[] = []
  for (const [x = 0, y = 0] of candidates) {
    const hit = probe.control(["ax-hit", String(x), String(y)])
    if (hit.role === "AXCheckBox" && hit.pid === probe.fixture.pid) return [String(x), String(y)]
    misses.push(`(${x},${y}) hit ${short(hit)}`)
  }
  return `no candidate point inside the AX frame ${short(frame)} hit-tests to the fixture checkbox: ${misses.join("; ")}`
}

export async function askPidClick(probe: Probe): Promise<Answer> {
  const pid = String(probe.fixture.pid)
  const target = probe.control(["ax-checkbox", pid])
  const frame = frameOf(target)
  if (frame === null) return unmeasured(`control failed: no AX frame for the fixture checkbox ${short(target)}`)
  const aimed = provenAim(probe, frame)
  if (typeof aimed === "string") return unmeasured(`aim not proven: ${aimed}`)
  const aim = aimed
  const notFront = await frontmost(probe, pid)
  if (notFront !== null) return unmeasured(`control not run: ${notFront}`)
  const global = await clickAt(probe, aim, "hid")
  if (typeof global === "string") return unmeasured(`control failed: global HID click ${global}`)
  const where = `aim ${short(aim)} proven by AX hit-test inside frame ${short(frame)}, fixture frontmost`
  if (global.toggled === undefined)
    return unmeasured(
      `global=not pid=untried: the global click at the same point did not toggle (${global.note}); ${where}`,
    )
  const notes = [global.note]
  for (const [route, name] of PID_ROUTES) {
    const pidClick = await clickAt(probe, aim, route)
    if (typeof pidClick === "string") {
      notes.push(`${name}: ${pidClick}`)
      continue
    }
    notes.push(`${name} ${pidClick.note}`)
    if (pidClick.toggled === undefined) continue
    const ax = probe.control(["ax-checkbox", pid])
    const evidence = `global=toggled pid=toggled (${name}); ${where}; ${notes.join("; ")}; AX read-back ${short(ax.value)}`
    return ax.value === (pidClick.toggled === "on" ? 1 : 0)
      ? confirms(evidence)
      : contradicts(`AX disagrees: ${evidence}`)
  }
  return contradicts(`global=toggled pid=not: ${where}; ${notes.join("; ")}`)
}

export function askCapture(probe: Probe): Answer {
  const read = probe.invoke(["capture", String(probe.fixture.pid)], 30_000)
  const error = failed(read)
  if (error !== null) return unmeasured(error)
  if (read.preflight === false && read.stats === undefined)
    return contradicts(`CGPreflightScreenCaptureAccess answered false: ${short(read)}`)
  if (read.stats === undefined) return unmeasured(`capture returned no image: ${short(read)}`)
  const pixels =
    numberField(read.stats, "nonBlackFraction") > 0.5 && numberField(read.stats, "fixtureColorFraction") > 0.3
  const evidence = `capture ${short(read)}`
  return read.preflight === true && pixels ? confirms(evidence) : contradicts(evidence)
}

export function askTap(probe: Probe): Answer {
  const read = probe.invoke(["tap-create"])
  const error = failed(read)
  if (error !== null) return unmeasured(error)
  const evidence = `listen-only tap ${short(read)}`
  return read.created === true ? confirms(evidence) : contradicts(`CGEventTapCreate returned nil: ${evidence}`)
}

function userDataSeen(events: unknown, value: number): boolean {
  return (
    Array.isArray(events) &&
    events.some((event) => typeof event === "object" && event !== null && Reflect.get(event, "userData") === value)
  )
}

export async function askSyntheticUser(binary: string, probe: Probe): Promise<Answer> {
  const ready = join(probe.scratch, "tap-watch.ready")
  rmSync(ready, { force: true })
  const watcher = Bun.spawn([binary, "tap-watch", PROBE_KEYCODE, "10", ready], { stdout: "pipe", stderr: "pipe" })
  const armed = await until(() => existsSync(ready), Boolean, 5_000)
  if (!armed || readFileSync(ready, "utf8") !== "ready") {
    watcher.kill()
    return unmeasured(`the listen tap could not be armed (${armed ? "no-tap" : "no ready signal in 5 s"})`)
  }
  const untagged = run(binary, ["post-key", PROBE_KEYCODE, "0"])
  const tagged = run(binary, ["post-key", PROBE_KEYCODE, PROBE_TAG])
  await watcher.exited
  const output = await new Response(watcher.stdout).text()
  const seen: unknown = output === "" ? {} : JSON.parse(output)
  const events = typeof seen === "object" && seen !== null && "events" in seen ? seen.events : []
  const evidence = `second-process posts ${untagged.stdout} / ${tagged.stdout}; tap saw ${short(events)}`
  const sawUntagged = userDataSeen(events, 0)
  const sawTagged = userDataSeen(events, Number(PROBE_TAG))
  if (sawUntagged && sawTagged) return confirms(evidence)
  if (!sawTagged) return unmeasured(`control failed: the tagged post never reached the tap; ${evidence}`)
  return contradicts(`tagged control seen, untagged post missing; ${evidence}`)
}
