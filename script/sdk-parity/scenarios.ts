import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { PARITY_DIR } from "./registry"

// The scenario table of design 7.3 (slice P1a, #14948). It is the one source the conformance drivers of P1b read: each
// scenario names its row, the input it passes, and the effect it expects as calls the fake ports of design 4.6 observe;
// a refusal scenario also names the code it answers. A row's `scenarios` field holds only ids from this table, never a
// second description.

export const SCENARIOS_DIR = join(PARITY_DIR, "scenarios")

export type Expectation = {
  readonly port: string
  /** What that fake port observes: the call it receives, or that it receives none. */
  readonly observes: string
}

export type Scenario = {
  /** `<row id>/<slug>`: stable, never reused for another behaviour. */
  readonly id: string
  readonly row: string
  readonly kind: "effect" | "refusal"
  readonly input: Readonly<Record<string, unknown>>
  /** The input is outside the call's input schema on purpose; such a scenario is a refusal with `invalid_arguments`. */
  readonly invalid?: true
  readonly refusal?: string
  readonly expect: readonly Expectation[]
}

export type ScenarioFile = {
  readonly domain: string
  /** `<row id>.<field>`: an input field with no behaviour of its own, and why. */
  readonly inert: Readonly<Record<string, string>>
  readonly scenarios: readonly Scenario[]
}

export function loadScenarioFiles(dir: string = SCENARIOS_DIR): ScenarioFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as ScenarioFile)
}
