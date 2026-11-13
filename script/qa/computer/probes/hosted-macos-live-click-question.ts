import { existsSync, readFileSync } from "node:fs"
import { type Json, short, until } from "./hosted-macos-live-host.ts"
import { type Answer, confirms, contradicts, failed, type Probe, unmeasured } from "./hosted-macos-live-questions.ts"

/**
 * Decision rule (written into the ledger before the run): q3 is CONFIRMS only when a pid-routed click toggles the
 * DEFAULT checkbox, recording the precondition the delivery needed (none / app active / first mouse). A toggle of
 * the first-mouse control alone is its own finding, never a pass. "No" needs a positive control: global clicks at the
 * same aim reach the window with the app active while pid-routed events never do, or pid-routed events arrive, toggle
 * nothing, and an AX press toggles the same checkbox. Anything else stays UNMEASURED.
 */

const PID_ROUTES = [
  ["cg", "CGEventPostToPid"],
  ["sl", "SLEventPostToPid"],
] as const

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

function frameOf(read: Json): readonly number[] | null {
  const frame = read.frame
  if (!Array.isArray(frame) || frame.length !== 4) return null
  const numbers = frame.filter((value): value is number => typeof value === "number")
  return numbers.length === 4 ? numbers : null
}

type Click = {
  readonly toggled: string | undefined
  readonly delivered: readonly string[]
  readonly note: string
}

async function clickAt(probe: Probe, aim: readonly string[], route: string, times = 1): Promise<Click | string> {
  const { fixture } = probe
  const before = stateLines(fixture.stateFile).length
  const eventsBefore = stateLines(fixture.eventFile).length
  for (let index = 0; index < times; index += 1) {
    const click = probe.invoke(["click", String(fixture.pid), String(fixture.windowNumber), ...aim, route])
    const error = failed(click)
    if (error !== null) return error
  }
  const toggled = await nextState(fixture.stateFile, before, probe.settleMs)
  const delivered = stateLines(fixture.eventFile).slice(eventsBefore)
  const arrival = delivered.length === 0 ? "window saw nothing" : `window saw ${short(delivered)}`
  return { toggled, delivered, note: `${route}x${times}: ${toggled ?? "no toggle"}; ${arrival}` }
}

const noteOf = (click: Click | string): string => (typeof click === "string" ? click : click.note)

function aimOf(probe: Probe, read: Json, key: "frame" | "firstMouseFrame"): readonly string[] | string {
  const frame = frameOf(key === "frame" ? read : { frame: read[key] })
  if (frame === null) return `no AX frame (${key}) for the fixture ${short(read)}`
  const [left = 0, top = 0, width = 0, height = 0] = frame
  const x = left + width / 2
  const y = top + height / 2
  const hit = probe.control(["ax-hit", String(x), String(y)])
  if (hit.role !== "AXCheckBox" || hit.pid !== probe.fixture.pid)
    return `aim (${x},${y}) in frame ${short(frame)} hit-tests to ${short(hit)}, not the fixture checkbox`
  return [String(x), String(y)]
}

function toggledDefault(click: Click | string): boolean {
  return typeof click !== "string" && click.toggled !== undefined && !click.toggled.startsWith("first-mouse")
}

async function frontmost(probe: Probe, pid: string): Promise<boolean | null> {
  const read = probe.control(["frontmost", pid])
  if (failed(read) !== null) return null
  return read.frontmost === true
}

async function activateFixture(
  probe: Probe,
  pid: string,
): Promise<{ readonly active: boolean; readonly note: string }> {
  const call = probe.control(["activate", pid])
  if (failed(call) !== null) return { active: false, note: `activate call failed: ${short(call)}` }
  const settled = await until(
    () => probe.control(["frontmost", pid]),
    (read) => failed(read) === null && read.frontmost === true,
    5_000,
  )
  const active = failed(settled) === null && settled.frontmost === true
  return { active, note: `NSRunningApplication activate ${short(call)}, frontmost=${active}` }
}

async function axPressControl(
  probe: Probe,
  pid: string,
): Promise<{ readonly toggled: boolean; readonly note: string }> {
  const before = stateLines(probe.fixture.stateFile).length
  const press = probe.control(["ax-press", pid])
  if (failed(press) !== null) return { toggled: false, note: `AX press control failed: ${short(press)}` }
  const state = await nextState(probe.fixture.stateFile, before, probe.settleMs)
  const toggled = state !== undefined && !state.startsWith("first-mouse")
  return { toggled, note: `AX press control ${short(press)}: ${state ?? "no toggle"}` }
}

export async function askPidClick(probe: Probe): Promise<Answer> {
  const pid = String(probe.fixture.pid)
  const target = probe.control(["ax-checkbox", pid])
  const aim = aimOf(probe, target, "frame")
  if (typeof aim === "string") return unmeasured(`aim not proven: ${aim}`)
  const notes: string[] = []
  const front = await frontmost(probe, pid)
  notes.push(`frontmost: ${front === null ? "unreadable" : front ? "yes" : "no"}`)

  const defaultClicks: (Click | string)[] = []
  let precondition = ""
  const double = await clickAt(probe, aim, "hid", 2)
  defaultClicks.push(double)
  notes.push(`two global clicks ${noteOf(double)}`)
  if (toggledDefault(double)) precondition = "none (a second global click at the same point)"

  if (precondition === "") {
    const activation = await activateFixture(probe, pid)
    notes.push(activation.note)
    if (activation.active) {
      const single = await clickAt(probe, aim, "hid")
      defaultClicks.push(single)
      notes.push(`activated-click ${noteOf(single)}`)
      if (toggledDefault(single)) precondition = "app active (NSRunningApplication activate)"
    }
  }

  const firstMouseAim = aimOf(probe, target, "firstMouseFrame")
  let firstMouseToggled = false
  if (typeof firstMouseAim === "string") {
    notes.push(`first-mouse control not aimed: ${firstMouseAim}`)
  } else {
    const firstMouse = await clickAt(probe, firstMouseAim, "hid")
    notes.push(`first-mouse ${noteOf(firstMouse)}`)
    firstMouseToggled = typeof firstMouse !== "string" && firstMouse.toggled !== undefined
    if (firstMouseToggled && precondition === "") {
      const afterFirstMouse = await clickAt(probe, aim, "hid")
      defaultClicks.push(afterFirstMouse)
      notes.push(`default click after the first-mouse toggle ${noteOf(afterFirstMouse)}`)
      if (toggledDefault(afterFirstMouse))
        precondition = "first mouse (the default control acts once the app has accepted a first mouse)"
    }
  }

  const pidClicks: (Click | string)[] = []
  for (const [route, name] of PID_ROUTES) {
    const pidClick = await clickAt(probe, aim, route)
    pidClicks.push(pidClick)
    notes.push(`${name} ${noteOf(pidClick)}`)
    if (toggledDefault(pidClick)) {
      const needed = precondition === "" ? "none (pid-routed delivery needed no activation)" : precondition
      return confirms(
        `pid-routed click (${name}) toggled the default checkbox; precondition: ${needed}; ${notes.join("; ")}`,
      )
    }
  }

  if (precondition !== "")
    return contradicts(
      `a global click toggled the default checkbox (precondition: ${precondition}) but no pid-routed click did; ${notes.join("; ")}`,
    )
  if (firstMouseToggled)
    return contradicts(
      `pointer delivery works but the default controls ignore the click while the app is not active: only the acceptsFirstMouse control toggled (its own finding, not a pass); ${notes.join("; ")}`,
    )
  const seen = defaultClicks.filter((click): click is Click => typeof click !== "string")
  const received = seen.some((click) => click.delivered.length > 0)
  const activeWhileReceived = seen.some((click) => click.delivered.some((line) => line.includes("active=true")))
  if (!received) return unmeasured(`the fixture window received no event at the proven aim; ${notes.join("; ")}`)
  if (!activeWhileReceived)
    return unmeasured(
      `the app never read active while the events arrived, so activation is the blocker; ${notes.join("; ")}`,
    )
  const pidArrived = pidClicks.some((click) => typeof click !== "string" && click.delivered.length > 0)
  const pidFailed = pidClicks.filter((click): click is string => typeof click === "string")
  if (!pidArrived && pidFailed.length > 0)
    return unmeasured(
      `a pid route did not post (its helper call failed), so its silence proves nothing: ${pidFailed.join("; ")}; ${notes.join("; ")}`,
    )
  if (!pidArrived)
    return contradicts(
      `pid-routed delivery refused: global clicks at the proven aim reached the window with the app active, while pid-routed events never reached the window; ${notes.join("; ")}`,
    )
  const press = await axPressControl(probe, pid)
  notes.push(press.note)
  if (press.toggled)
    return contradicts(
      `no is proven against the AX press control: pid-routed events reached the window and toggled nothing, while the AX press control toggled the same checkbox; ${notes.join("; ")}`,
    )
  return unmeasured(
    `the toggle oracle is unproven: no click on any route and not the AX press control toggled the checkbox; ${notes.join("; ")}`,
  )
}
