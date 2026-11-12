// The shipped-runtime driver of the conformance catalog (`run.ts --driver legacy`, ideal-state plan row 8).
//
// The subject is the RELEASED OmO Native (`omo-ai`) with its current `computer` tool at default settings: the driver
// loads the release's own computer-use bundle and calls the tool's `execute` with `run` code, as a session would,
// with no model, no host UI and no foreground grant. Nothing here changes the shipped runtime: a cell it fails,
// refuses or disturbs is the baseline's finding.
//
// The fixture apps (row 4) and the desktop observer (row 3; rows 27, 30 and 31 for Windows and Linux) are seams.
// While one is missing a cell is recorded `not_run` naming it and nothing is sent: an action whose effect or
// disturbance cannot be read would be a guess.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cellId } from "../catalog.ts"
import type { Driver } from "../driver.ts"
import type { Task } from "../taskset/tasks.ts"
import type { Cell, CellResult } from "../vocabulary.ts"
import { cellCode, type FixtureTarget } from "./legacy-code.ts"
import { runControl } from "./legacy-control.ts"
import { hostFixtures } from "./legacy-fixtures.ts"
import { isRecord, loadShippedTool, shippedBundle, type Slot } from "./legacy-release.ts"

type Journal = CellResult["journal"]
type Observed = CellResult["observed"]

export interface Fixtures {
  target(cell: Cell): FixtureTarget | { readonly unavailable: string }
  reset(cell: Cell): Promise<void>
  read(cell: Cell): Promise<unknown>
  resetTask(task: Task): Promise<void>
  saved(task: Task): Promise<Readonly<Record<string, unknown>>>
  stop(): Promise<void>
}

export interface Observer {
  observe<T>(act: () => Promise<T>): Promise<{ readonly value: T; readonly journal: Journal }>
}

export interface ShippedTool {
  execute(toolCallId: string, input: Readonly<Record<string, unknown>>, context: HostContext): Promise<unknown>
}

type HostContext = Readonly<Record<string, unknown>>

interface LegacyDriverParts {
  /** The host session directory the shipped tool writes its audit log into. */
  readonly session: () => string
  /** How long a cell waits for the fixture to show its declared value; tests pass 0. */
  readonly settleMs?: number
  readonly tool: Slot<ShippedTool>
  readonly fixtures: Slot<Fixtures>
  readonly observer: Slot<Observer>
}

const NONE = { signal: "none", firstAt: null, count: 0 } as const
const EMPTY_JOURNAL: Journal = {
  key_focus: NONE,
  window_raised: NONE,
  typing: NONE,
  pointer: NONE,
  clipboard: NONE,
  space: NONE,
  dialog: NONE,
  activation: NONE,
}
const UNREAD = { signal: "not_observed", firstAt: null, count: 0 } as const
const UNREAD_JOURNAL: Journal = {
  key_focus: UNREAD,
  window_raised: UNREAD,
  typing: UNREAD,
  pointer: UNREAD,
  clipboard: UNREAD,
  space: UNREAD,
  dialog: UNREAD,
  activation: UNREAD,
}

// With no observer for this OS the cell still runs and its outcome and fixture value are recorded, but every signal
// reads not_observed and the reason travels with it: the report counts the cell unobserved, never clean (P-17).
function unobserved(reason: string): Observer & { readonly reason: string } {
  return { reason, observe: async (act) => ({ value: await act(), journal: UNREAD_JOURNAL }) }
}

/**
 * The shipped runtime's engine errors carry `code`, `hint`, `permission` and `reason`, and never say whether input
 * was sent, so every refusal is recorded `nothingSent: false`: that absence is part of the baseline.
 */
export function readOutcome(result: unknown): Observed {
  const value = isRecord(result) && isRecord(result.details) ? result.details.value : undefined
  if (isRecord(result) && result.isError === true) {
    return isRecord(value) && typeof value.code === "string"
      ? { kind: "refused", code: value.code, nothingSent: false }
      : { kind: "error", message: `the tool failed without a code: ${JSON.stringify(value)}` }
  }
  if (isRecord(value) && value.kind === "delivered") return { kind: "delivered" }
  if (isRecord(value) && value.kind === "refused" && typeof value.code === "string")
    return { kind: "refused", code: value.code, nothingSent: false }
  if (isRecord(value) && value.kind === "error" && typeof value.message === "string")
    return { kind: "error", message: value.message }
  return { kind: "error", message: `the run returned no outcome: ${JSON.stringify(value)}` }
}

function hostContext(dir: string): HostContext {
  return {
    cwd: dir,
    model: undefined,
    sessionManager: { getSessionId: () => "conformance-legacy", getSessionDir: () => dir },
    hasUI: false,
  }
}

const notRun = (cell: Cell, reason: string): CellResult => ({
  id: cellId(cell),
  observed: { kind: "not_run", reason },
  oracle: { observed: null },
  durationMs: 0,
  journal: EMPTY_JOURNAL,
})

// The fixture applies posted input on its own event loop, after the tool has returned; read its report until it
// shows the declared value or a bounded wait ends, so a slow-but-delivered action is not recorded as no effect.
const SETTLE_MS = 3_000
const SETTLE_STEP_MS = 100

async function settled(read: () => Promise<unknown>, expected: unknown, budgetMs: number): Promise<unknown> {
  const deadline = performance.now() + budgetMs
  let value = await read()
  while (value !== expected && performance.now() < deadline) {
    await Bun.sleep(SETTLE_STEP_MS)
    value = await read()
  }
  return value
}

type Ready = {
  readonly tool: ShippedTool
  readonly fixtures: Fixtures
  readonly observer: Observer & { readonly reason?: string }
}

function ready(parts: LegacyDriverParts): Ready | string {
  if ("unavailable" in parts.tool) return `shipped_runtime_unavailable: ${parts.tool.unavailable}`
  if ("unavailable" in parts.fixtures) return `fixture_unavailable: ${parts.fixtures.unavailable}`
  const observer = "unavailable" in parts.observer ? unobserved(parts.observer.unavailable) : parts.observer.ready
  return { tool: parts.tool.ready, fixtures: parts.fixtures.ready, observer }
}

export function createLegacyDriver(parts: LegacyDriverParts): Driver {
  let context: HostContext | undefined
  let calls = 0
  const run = (tool: ShippedTool, code: string) => {
    context ??= hostContext(parts.session())
    return tool.execute(`conformance-${++calls}`, { action: "run", code }, context)
  }

  return {
    async runCell(cell) {
      const available = ready(parts)
      if (typeof available === "string") return notRun(cell, available)
      const { tool, fixtures, observer } = available
      const target = fixtures.target(cell)
      if ("unavailable" in target) return notRun(cell, `fixture_unavailable: ${target.unavailable}`)
      const code = cellCode(cell, target)
      try {
        await fixtures.reset(cell)
        const started = performance.now()
        const { value, journal } = await observer.observe(() => run(tool, code))
        const durationMs = performance.now() - started
        const observed = await settled(() => fixtures.read(cell), cell.oracle.equals, parts.settleMs ?? SETTLE_MS)
        const returned = isRecord(value) && isRecord(value.details) ? value.details.value : undefined
        const aim = isRecord(returned) ? returned.aim : undefined
        if (aim !== undefined)
          console.log(`CELL_EVIDENCE ${cellId(cell)} aim=${JSON.stringify(aim)} fixture=${JSON.stringify(observed)}`)
        const result = { id: cellId(cell), observed: readOutcome(value), oracle: { observed }, durationMs, journal }
        return observer.reason === undefined ? result : { ...result, observerUnavailable: observer.reason }
      } finally {
        await fixtures.stop()
      }
    },
    async runTask(task) {
      if (!("ready" in parts.tool)) throw new Error(`task ${task.id} cannot run: ${parts.tool.unavailable}`)
      if (!("ready" in parts.fixtures)) throw new Error(`task ${task.id} cannot run: ${parts.fixtures.unavailable}`)
      const tool = parts.tool.ready
      const fixtures = parts.fixtures.ready
      try {
        await fixtures.resetTask(task)
        let cells = 0
        for (const cell of task.cells) {
          cells += 1
          const result = await run(tool, cell.code).catch((error: unknown) => ({ isError: true, error }))
          if (isRecord(result) && result.isError === true) break
        }
        return { saved: await fixtures.saved(task), cells }
      } finally {
        await fixtures.stop()
      }
    },
  }
}

const shippedTool = await loadShippedTool()

let sessionDir: string | undefined
const session = (): string => (sessionDir ??= mkdtempSync(join(tmpdir(), "conformance-legacy-")))

export const driver: Driver = createLegacyDriver({
  session,
  tool: shippedTool,
  fixtures: hostFixtures(process.platform, process.env, session),
  observer: {
    unavailable:
      "no desktop observer is wired for this OS: row 3 builds the macOS observer, rows 27, 30 and 31 the Windows and Linux recorders",
  },
})

// `--smoke`: proves on a runner that the installed release loads and its tool reaches its own engine (the
// `capabilities` action activates the session and acquires the release's engine), with no model and no credential.
async function smoke(): Promise<number> {
  const bundle = shippedBundle(process.env)
  const refuse = (reason: string): number => {
    console.log(`LEGACY_SMOKE status=unavailable reason=${JSON.stringify(reason)}`)
    return 1
  }
  if ("unavailable" in bundle) return refuse(bundle.unavailable)
  if ("unavailable" in shippedTool) return refuse(shippedTool.unavailable)
  const result = await shippedTool.ready.execute(
    "conformance-smoke",
    { action: "capabilities" },
    hostContext(session()),
  )
  const failed = isRecord(result) && result.isError === true
  const value = isRecord(result) && isRecord(result.details) ? result.details.value : undefined
  console.log(
    `LEGACY_SMOKE release=${bundle.ready.version} status=${failed ? "error" : "ok"} capabilities=${JSON.stringify(value)}`,
  )
  return failed ? 1 : 0
}

if (import.meta.main && process.argv.includes("--smoke")) process.exit(await smoke())
if (import.meta.main && process.argv.includes("--control"))
  process.exit(
    await runControl({
      platform: process.platform,
      tool: shippedTool,
      fixtures: hostFixtures(process.platform, process.env, session),
      context: () => hostContext(session()),
      settle: (read, expected) => settled(read, expected, SETTLE_MS),
    }),
  )
