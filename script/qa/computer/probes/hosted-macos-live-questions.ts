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

export const confirms = (evidence: string): Answer => ({ verdict: "CONFIRMS", evidence })
export const contradicts = (evidence: string): Answer => ({ verdict: "CONTRADICTS", evidence })
export const unmeasured = (evidence: string): Answer => ({ verdict: "UNMEASURED", evidence })

export function failed(read: Json): string | null {
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
