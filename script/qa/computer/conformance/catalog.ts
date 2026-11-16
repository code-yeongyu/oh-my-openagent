import { ACTION_TARGETINGS, type DeclaredOs, declare, MODES, PERSONA_OS, type Route, TOOLKITS } from "./declarations.ts"
import type { Action, Cell, Expect, OsName, Oracle, Persona } from "./vocabulary.ts"

export type { Cell, CellResult, SignalId, SignalSummary } from "./vocabulary.ts"

export const SESSIONS: Readonly<Record<OsName, string>> = {
  fake: "headless",
  macos: "aqua",
  windows: "console",
  x11: "xorg",
  wayland: "sway",
}

const PERSONAS: readonly Persona[] = ["macos", "win32", "x11", "wayland"]

const EFFECT: Readonly<Record<Action, Oracle>> = {
  click: { field: "pressCount", equals: 1 },
  "ax.perform": { field: "pressCount", equals: 1 },
  typeText: { field: "value", equals: "conformance" },
  "ax.setValue": { field: "value", equals: "conformance" },
  keyChord: { field: "receivedKeys", equals: "ctrl+k" },
  scroll: { field: "scrollSteps", equals: 3 },
  drag: { field: "dragOrder", equals: "b,a,c" },
  "menu.select": { field: "menuSelection", equals: "Conformance" },
}

const UNTOUCHED: Readonly<Record<Action, Oracle>> = {
  click: { field: "pressCount", equals: 0 },
  "ax.perform": { field: "pressCount", equals: 0 },
  typeText: { field: "value", equals: "" },
  "ax.setValue": { field: "value", equals: "" },
  keyChord: { field: "receivedKeys", equals: "" },
  scroll: { field: "scrollSteps", equals: 0 },
  drag: { field: "dragOrder", equals: "a,b,c" },
  "menu.select": { field: "menuSelection", equals: "" },
}

function oracleFor(action: Action, expect: Expect): Oracle {
  return "deliver" in expect ? EFFECT[action] : UNTOUCHED[action]
}

export function cellId(cell: Cell): string {
  const where = cell.persona === undefined ? `${cell.os}/${cell.session}` : `${cell.os}/${cell.session}/${cell.persona}`
  return `${where}/${cell.toolkit}/${cell.action}/${cell.targeting}/${cell.mode}`
}

function routes(): Route[] {
  return TOOLKITS.flatMap((toolkit) =>
    ACTION_TARGETINGS.flatMap(([action, targeting]) => MODES.map((mode) => ({ toolkit, action, targeting, mode }))),
  )
}

function cellsOf(os: OsName, declaredOs: DeclaredOs, persona: Persona | undefined): Cell[] {
  return routes().map((route) => {
    const { expect, declares, basis } = declare(declaredOs, route)
    const where = persona === undefined ? { os, session: SESSIONS[os] } : { os, session: SESSIONS[os], persona }
    return { ...where, ...route, expect, declares, basis, oracle: oracleFor(route.action, expect) }
  })
}

/** Every cell of one OS session; the fake session holds one copy of the grid per persona, each declared like its OS. */
export function catalogFor(os: OsName, session: string): Cell[] {
  if (SESSIONS[os] !== session) return []
  if (os === "fake") return PERSONAS.flatMap((persona) => cellsOf(os, PERSONA_OS[persona], persona))
  return cellsOf(os, os, undefined)
}
