// `--control`: independent checks of the "delivered but the application never received it" cells. Per leg the
// release sends its background action on a fresh fixture; then an input path outside the tool acts on the same target
// and the fixture is read after each. On x11 that is xdotool at the same global point; on Windows it is SendInput from
// `send-input.ps1`, with the foreground window and the focused control logged before every step, so the control shows
// the independent input reached the control the release addressed. The verdict rules are in BASELINE.md, fixed
// before the runs; the lines printed here are the evidence and never fail the job.

import { join } from "node:path"

import { catalogFor } from "../catalog.ts"
import type { Cell } from "../vocabulary.ts"
import { cellCode, type FixtureTarget } from "./legacy-code.ts"
import { isRecord, type Slot } from "./legacy-release.ts"
import type { Fixtures, ShippedTool } from "./legacy.ts"

export interface ControlParts {
  readonly platform: string
  readonly tool: Slot<ShippedTool>
  readonly fixtures: Slot<Fixtures>
  readonly context: () => Readonly<Record<string, unknown>>
  readonly settle: (read: () => Promise<unknown>, expected: unknown) => Promise<unknown>
}

interface Point {
  readonly x: number
  readonly y: number
}

type Say = (line: string) => void
type Independent = (point: Point | undefined, target: FixtureTarget, say: Say) => Promise<void>

interface Leg {
  readonly os: "x11" | "windows"
  readonly action: Cell["action"]
  readonly targeting: Cell["targeting"]
  readonly expected: unknown
  readonly independent: Independent
}

async function spawnLine(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return `exit=${code} ${(out + err).trim().replaceAll(/\r?\n/g, " | ").slice(0, 400)}`
}

const xdotool = (...args: string[]): Promise<string> => spawnLine(["xdotool", ...args])

const SEND_INPUT = join(import.meta.dir, "send-input.ps1")
const sendInput = (...args: string[]): Promise<string> =>
  spawnLine(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SEND_INPUT, ...args])

const xdotoolAt =
  (buttons: readonly string[]): Independent =>
  async (point, target, say) => {
    if (point === undefined) return say("independent skipped: the release reported no aim point")
    const name = `^${target.title}$`
    say(`geometry ${await xdotool("search", "--name", name, "getwindowgeometry")}`)
    say(`raise ${await xdotool("search", "--name", name, "windowactivate", "--sync")}`)
    say(
      `xdotool at ${point.x},${point.y} ${await xdotool("mousemove", "--sync", String(point.x), String(point.y), ...buttons)}`,
    )
  }

const xdotoolChord: Independent = async (_point, target, say) => {
  say(`raise ${await xdotool("search", "--name", `^${target.title}$`, "windowactivate", "--sync")}`)
  say(`focus before chord ${await xdotool("getwindowfocus", "getwindowname")}`)
  say(`chord ${await xdotool("key", "--clearmodifiers", "ctrl+k")}`)
}

const typeAtPoint: Independent = async (point, target, say) => {
  if (point === undefined) return say("independent skipped: the release reported no aim point")
  say(`raise ${await sendInput("-Do", "focus", "-Window", target.title)}`)
  say(`probe before click ${await sendInput("-Do", "probe")}`)
  say(`click at ${point.x},${point.y} ${await sendInput("-Do", "click", "-X", String(point.x), "-Y", String(point.y))}`)
  say(`probe before typing ${await sendInput("-Do", "probe")}`)
  say(`type ${await sendInput("-Do", "text", "-Text", "conformance")}`)
}

const chordToElement: Independent = async (_point, target, say) => {
  say(`focus ${await sendInput("-Do", "focus", "-Window", target.title, "-Name", target.element.title)}`)
  say(`probe before chord ${await sendInput("-Do", "probe")}`)
  say(`chord ${await sendInput("-Do", "chord")}`)
}

const LEGS: readonly Leg[] = [
  { os: "x11", action: "click", targeting: "ax", expected: 1, independent: xdotoolAt(["click", "1"]) },
  {
    os: "x11",
    action: "scroll",
    targeting: "ax",
    expected: 3,
    independent: xdotoolAt(["click", "--repeat", "3", "5"]),
  },
  { os: "x11", action: "keyChord", targeting: "ax", expected: "ctrl+k", independent: xdotoolChord },
  { os: "windows", action: "typeText", targeting: "px", expected: "conformance", independent: typeAtPoint },
  { os: "windows", action: "keyChord", targeting: "ax", expected: "ctrl+k", independent: chordToElement },
]

const SESSION = { x11: "xorg", windows: "console" } as const

function aimPoint(value: unknown): Point | undefined {
  const point = isRecord(value) && isRecord(value.aim) && isRecord(value.aim.point) ? value.aim.point : undefined
  return point !== undefined && typeof point.x === "number" && typeof point.y === "number"
    ? { x: point.x, y: point.y }
    : undefined
}

export async function runControl(parts: ControlParts): Promise<number> {
  const top: Say = (line) => console.log(`LEGACY_CONTROL ${line}`)
  if ("unavailable" in parts.tool)
    return (top(`status=unavailable reason=${JSON.stringify(parts.tool.unavailable)}`), 1)
  if ("unavailable" in parts.fixtures)
    return (top(`status=unavailable reason=${JSON.stringify(parts.fixtures.unavailable)}`), 1)
  const os = parts.platform === "linux" ? "x11" : parts.platform === "win32" ? "windows" : undefined
  if (os === undefined) return (top(`skipped: no control for ${parts.platform}`), 1)
  const tool = parts.tool.ready
  const fixtures = parts.fixtures.ready
  for (const leg of LEGS.filter((entry) => entry.os === os)) {
    const say: Say = (line) => top(`${leg.action} ${line}`)
    const cell = catalogFor(os, SESSION[os]).find(
      (entry) =>
        entry.toolkit === "native" &&
        entry.action === leg.action &&
        entry.targeting === leg.targeting &&
        entry.mode === "background",
    )
    if (cell === undefined) throw new Error(`the catalog has no native background ${leg.targeting} ${leg.action}`)
    const target = fixtures.target(cell)
    if ("unavailable" in target) return (say(`status=unavailable reason=${JSON.stringify(target.unavailable)}`), 1)
    try {
      await fixtures.reset(cell)
      if (os === "windows") say(`probe before release ${await sendInput("-Do", "probe")}`)
      const outcome = await tool.execute(
        `conformance-control-${leg.action}`,
        { action: "run", code: cellCode(cell, target) },
        parts.context(),
      )
      const value = isRecord(outcome) && isRecord(outcome.details) ? outcome.details.value : outcome
      const afterRelease = await parts.settle(() => fixtures.read(cell), leg.expected)
      say(`release outcome=${JSON.stringify(value)} fixture=${JSON.stringify(afterRelease)}`)
      await leg.independent(aimPoint(value), target, say)
      const afterIndependent = await parts.settle(() => fixtures.read(cell), leg.expected)
      say(
        `VERDICT independent=${JSON.stringify(afterIndependent)} release=${JSON.stringify(afterRelease)} expected=${JSON.stringify(leg.expected)}`,
      )
    } finally {
      await fixtures.stop()
    }
  }
  return 0
}
