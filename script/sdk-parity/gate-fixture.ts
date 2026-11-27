import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type Baseline, ORIGINAL_PATH, UNRESOLVED_PATH } from "./baseline"
import type { GateInput } from "./gate"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import type { Scenario } from "./scenarios"

// The shared fixture of the gate's negative controls: the real rows and manifest, one scenario on threads.send, and two
// fixed heads, so each control changes exactly one input of gateReport.

export const rows = allRows(loadDomainFiles())
export const text = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")
export const original = text(ORIGINAL_PATH)
export const unresolved = JSON.parse(text(UNRESOLVED_PATH)) as Baseline
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
