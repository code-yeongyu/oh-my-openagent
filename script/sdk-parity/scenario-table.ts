import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { ScenarioTableFile } from "./expectation"

// The scenario table of design 7.3 (slice P1a, #14948): one file per namespace under scenarios/, the one source the
// conformance drivers of P1b read. The shape of a scenario and of an expected effect is defined once, in
// expectation.ts; this module only loads the table.
export type { Expectation, ScenarioTableFile, TableScenario } from "./expectation"

const SCENARIOS_DIR = join(import.meta.dir, "scenarios")

export function loadScenarioTable(dir: string = SCENARIOS_DIR): ScenarioTableFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as ScenarioTableFile)
}
