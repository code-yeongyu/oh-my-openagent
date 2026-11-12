// The scenario contract of the live Windows driver.
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
