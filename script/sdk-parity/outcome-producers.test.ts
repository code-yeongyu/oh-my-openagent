import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OUTCOME_RUNNER, outcomeProducers } from "./outcome-producers"
import { REPO_ROOT } from "./registry"

// Security contract (limit 1 of #15208's gate-rule read): the files whose change is a gate change are computed from the
// runner's imports, so a module the runner starts to import (a normalizer moved into its own file) joins the set with
// no list to edit, and a module it does not import stays out.
const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const tree = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), "sdk-parity-producers-"))
  roots.push(root)
  mkdirSync(join(root, "script/sdk-parity"), { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "script/sdk-parity", name), text)
  return root
}
const at = (name: string) => `script/sdk-parity/${name}`

describe("the files that produce or normalize an outcome", () => {
  test("#given the runner's static, dynamic and transitive imports #then each is in the set and an unimported file is not", () => {
    const root = tree({
      "scenario-run.ts": 'import { a } from "./a"\nconst b = await import("./b")\n',
      "a.ts": 'import { c } from "./c"\nexport const a = c\n',
      "b.ts": "export const b = 1\n",
      "c.ts": "export const c = 1\n",
      "gate.ts": 'import { a } from "./a"\n',
    })
    expect(outcomeProducers(root)).toEqual([at("a.ts"), at("b.ts"), at("c.ts"), OUTCOME_RUNNER])
  })

  test("#given a module the runner newly imports #then it joins the set without a list being edited", () => {
    const files = { "scenario-run.ts": "export {}\n", "normalize.ts": "export const normalize = 1\n" }
    expect(outcomeProducers(tree(files))).toEqual([OUTCOME_RUNNER])
    const moved = { ...files, "scenario-run.ts": 'import { normalize } from "./normalize"\n' }
    expect(outcomeProducers(tree(moved))).toEqual([at("normalize.ts"), OUTCOME_RUNNER])
  })

  test("#given a type-only import #then it is not a producer: a type cannot change an outcome", () => {
    const root = tree({
      "scenario-run.ts": 'import type { T } from "./types"\nimport { type U } from "./more-types"\n',
      "types.ts": "export type T = 1\n",
      "more-types.ts": "export type U = 1\n",
    })
    expect(outcomeProducers(root)).toEqual([OUTCOME_RUNNER])
  })

  test("#given this repository #then the runner, its scenario table and the tool registry it discovers tools with are producers", () => {
    const producers = outcomeProducers(REPO_ROOT)
    expect(producers).toEqual(expect.arrayContaining([OUTCOME_RUNNER, at("scenarios.ts"), at("tool-registry.ts")]))
    expect(producers).not.toContain(at("gate.ts"))
  })
})
