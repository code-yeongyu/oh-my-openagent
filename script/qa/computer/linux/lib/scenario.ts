// The live Linux driver's contract: one scenario is one file, it declares how its session is
// admitted, and every fact it asserts is read by an independent process, never the engine's
// own report.
import type { Engine, JsonObject } from "./engine.ts"
import type { Processes } from "./procs.ts"

/** How a scenario's session is admitted (the plan's '### Real-surface QA drivers'). */
export type Admit = "os" | "host-relay" | "none"
export const ADMITS: readonly Admit[] = ["os", "host-relay", "none"]

export const SESSIONS = ["xvfb", "xvfb-nobus", "none", "xorg", "sway", "weston", "gnome", "kde"] as const
export type SessionName = (typeof SESSIONS)[number]

/** What a started session gives a scenario: the display and the environment its tools need. */
export interface Stage {
  readonly session: SessionName
  readonly display: string | undefined
  readonly env: Record<string, string | undefined>
  readonly runDir: string
}

export interface Context {
  readonly procs: Processes
  readonly stage: Stage
  readonly engine: Engine
}

export interface Scenario {
  readonly admit: Admit
  /** The sessions this scenario runs under; the driver refuses any other. */
  readonly sessions: readonly SessionName[]
  run(ctx: Context): Promise<Checked>
}

export interface Checked {
  readonly checks: Record<string, boolean>
  readonly facts: JsonObject
  readonly observer: { readonly before: JsonObject; readonly after: JsonObject }
}

export interface Result {
  readonly scenario: string
  readonly session: SessionName
  readonly verdict: "PASS" | "FAIL"
  readonly facts: JsonObject
  readonly observer: Checked["observer"]
}

export function verdict(scenario: string, session: SessionName, checked: Checked): Result {
  const failed = Object.entries(checked.checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)
  return {
    scenario,
    session,
    verdict: failed.length === 0 ? "PASS" : "FAIL",
    facts: { ...checked.facts, checks: { ...checked.checks }, failed },
    observer: checked.observer,
  }
}

export function failed(scenario: string, session: SessionName, error: unknown): Result {
  return {
    scenario,
    session,
    verdict: "FAIL",
    facts: { error: error instanceof Error ? error.message : String(error) },
    observer: { before: {}, after: {} },
  }
}

export function isSession(name: string): name is SessionName {
  return SESSIONS.some((known) => known === name)
}

export function isAdmit(value: unknown): value is Admit {
  return typeof value === "string" && ADMITS.some((known) => known === value)
}
