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
}

export type Invoke = (args: readonly string[], timeoutMs?: number) => Json

export type Probe = {
  readonly invoke: Invoke
  readonly control: Invoke
  readonly fixture: Fixture
  readonly textEditPid: number | null
  readonly scratch: string
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

async function nextState(file: string, before: number): Promise<string | undefined> {
  const lines = await until(
    () => stateLines(file),
    (read) => read.length > before,
    5_000,
  )
  return lines.length > before ? lines.at(-1) : undefined
}

const CLICK_ROUTES = [
  ["cg", "CGEventPostToPid"],
  ["sl", "SLEventPostToPid"],
] as const

function frameOf(read: Json): readonly number[] | null {
  const frame = read.frame
  if (!Array.isArray(frame) || frame.length !== 4) return null
  const numbers = frame.filter((value): value is number => typeof value === "number")
  return numbers.length === 4 ? numbers : null
}

export async function askPidClick(probe: Probe): Promise<Answer> {
  const { fixture } = probe
  const pid = String(fixture.pid)
  const target = probe.control(["ax-checkbox", pid])
  const frame = frameOf(target)
  if (frame === null) return unmeasured(`control failed: no AX frame for the fixture checkbox ${short(target)}`)
  const [left = 0, top = 0, width = 0, height = 0] = frame
  const aim = [String(left + width / 2), String(top + height / 2)]
  const attempts: string[] = []
  let posted = false
  for (const [route, name] of CLICK_ROUTES) {
    const before = stateLines(fixture.stateFile).length
    const click = probe.invoke(["click", pid, String(fixture.windowNumber), ...aim, route])
    const error = failed(click)
    if (error !== null) {
      attempts.push(`${name}: ${error}`)
      continue
    }
    posted = true
    const state = await nextState(fixture.stateFile, before)
    if (state === undefined) {
      attempts.push(`${name}: no toggle within 5 s of ${short(click)}`)
      continue
    }
    const ax = probe.control(["ax-checkbox", pid])
    const evidence = `${name} aimed at the AX frame ${short(frame)}; ${short(click)}; fixture report ${state}; AX read-back ${short(ax.value)}; earlier routes: ${attempts.join("; ") || "none"}`
    return ax.value === (state === "on" ? 1 : 0) ? confirms(evidence) : contradicts(`AX disagrees: ${evidence}`)
  }
  if (!posted) return unmeasured(`no route posted: ${attempts.join("; ")}`)
  const controlBefore = stateLines(fixture.stateFile).length
  const press = probe.control(["ax-press", pid])
  const controlState = await nextState(fixture.stateFile, controlBefore)
  if (controlState === undefined)
    return unmeasured(`control failed: AX press ${short(press)} did not toggle the fixture`)
  return contradicts(
    `aimed at the AX frame ${short(frame)}: ${attempts.join("; ")}; control AX press toggled to ${controlState}`,
  )
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
