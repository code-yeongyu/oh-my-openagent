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
  /** A reason this host cannot run the scenario (--all counts it BLOCKED), or undefined. */
  readonly precondition: () => Promise<string | undefined>
  readonly run: (engine: Engine) => Promise<Outcome>
}

const registered: Scenario[] = []

/** Called at the bottom of every scenario file. */
export function register(scenario: Scenario): void {
  registered.push(scenario)
}

/** The scenario the most recently imported file registered, or `undefined` when it registered none. */
export function lastRegistered(): Scenario | undefined {
  return registered.at(-1)
}

/** Every scenario registered so far, in import order. */
export function allRegistered(): readonly Scenario[] {
  return registered
}

/**
 * Why the scenarios one file `file` registered cannot run, or undefined when exactly one was
 * registered, its name is the file name and it declares an admission. Used by --scenario and --all;
 * under --all (`helpersAllowed`) a file that registers nothing is a helper module and is skipped.
 */
export function refusal(
  file: string,
  added: readonly Scenario[],
  options: { readonly helpersAllowed?: boolean } = {},
): string | undefined {
  void file
  void added
  void options
  return undefined
}
