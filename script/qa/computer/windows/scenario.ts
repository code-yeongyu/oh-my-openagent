// The scenario contract of the live Windows driver. A scenario file REGISTERS itself when it is
// imported, so a later row adds its scenario file without touching the driver's entry file.
import type { Engine } from "./engine.ts"

export const ADMISSIONS = ["os", "host-relay", "none"] as const
export type Admission = (typeof ADMISSIONS)[number]

export type Outcome = {
  readonly pass: boolean
  readonly facts: Record<string, unknown>
  /** Teardown receipts of what the scenario started (`window CLOSED <title>`). */
  readonly receipts: readonly string[]
}

export type Scenario = {
  readonly name: string
  readonly admit: Admission
  readonly run: (engine: Engine) => Promise<Outcome>
}

let registered: Scenario | undefined

/** Called at the bottom of every scenario file; the driver reads the last registration. */
export function register(scenario: Scenario): void {
  registered = scenario
}

/** The scenario the imported file registered, or `undefined` when it registered none. */
export function lastRegistered(): Scenario | undefined {
  return registered
}
