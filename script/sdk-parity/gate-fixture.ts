import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type Baseline, ORIGINAL_PATH } from "./baseline"
import type { GateInput } from "./gate"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import type { Scenario } from "./scenarios"

// The shared fixture of the gate's negative controls: the real rows and the original manifest, one scenario on
// threads.send, and two fixed heads, so each control changes exactly one input of gateReport. A control judges only the
// rows it names: every row's scenario list starts empty and every row starts unresolved, as in the original baseline, so
// a row another slice clears or fills (with its own runs) never reaches a control's verdict. The live manifest and the
// real scenario lists are judged by the gate itself, over every run (gate-cli).

export const rows = allRows(loadDomainFiles()).map((row) => ({ ...row, scenarios: { effect: [], refusal: [] } }))
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
  ...overrides,
})
