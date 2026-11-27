import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type Baseline, ORIGINAL_PATH } from "./baseline"
import type { GateInput } from "./gate"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import type { Scenario } from "./scenarios"

// The shared fixture of the gate's negative controls: the real rows and the original manifest, one scenario on
// threads.send, and two fixed heads, so each control changes exactly one input of gateReport. A control judges only the
// rows it names, except the rows the tree really builds: every other row's scenario list starts empty and every row in
// the original baseline starts unresolved, so a row another slice fills later never reaches a control's verdict. A row
// built today (filled per scenario-fill-owners.json, not in the original baseline) keeps its real scenarios, and the
// controls hand the gate its real run evidence (conformance-fixture.ts headEvidence), so they judge the tree that ships.

const FILLED = new Set(
  Object.keys(
    (
      JSON.parse(readFileSync(join(REPO_ROOT, "script/sdk-parity/scenario-fill-owners.json"), "utf8")) as {
        readonly rows: Readonly<Record<string, string>>
      }
    ).rows,
  ),
)
export const rows = allRows(loadDomainFiles()).map((row) =>
  FILLED.has(row.id) ? row : { ...row, scenarios: { effect: [], refusal: [] } },
)
export const filledRows = rows.filter((row) => FILLED.has(row.id))
export const text = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")
export const original = text(ORIGINAL_PATH)
export const unresolved = JSON.parse(original) as Baseline
export const HEAD = "a".repeat(40)
export const EARLIER = "b".repeat(40)
const scenario: Scenario = {
  id: "s1",
  capability: "threads.send",
  surface: "native",
  argv: ["thread", "send", "x"],
}

export const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  base: { rows, tools: [], outcomes: { s1: { exit: 2 } }, unresolved: unresolved.entries },
  head: { rows, tools: [], outcomes: { s1: { exit: 2 } }, unresolved: unresolved.entries },
  scenarios: [scenario],
  closures: new Map([["threads.send", new Set(["packages/omo-native/bin/lib/thread.js"])]]),
  changedFiles: [],
  body: "",
  headSha: HEAD,
  presentation: { base: [], head: [] },
  goldens: { base: {}, head: {} },
  versions: { base: undefined, head: { omo: "0.0.0", engine: "0.0.0" } },
  ...overrides,
})
