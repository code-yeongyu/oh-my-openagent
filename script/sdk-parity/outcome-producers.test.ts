import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gateChangeSet, OUTCOME_RUNNER, outcomeProducers, TIER_FILES } from "./outcome-producers"
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
// The producers reached from the runner, without the tier files every set carries by rule.
const producersOnly = (root: string) => outcomeProducers(root).filter((file) => !TIER_FILES.includes(file))

describe("the files that produce or normalize an outcome", () => {
  test("#given the runner's static, dynamic and transitive imports #then each is in the set and an unimported file is not", () => {
    const root = tree({
      "scenario-run.ts": 'import { a } from "./a"\nconst b = await import("./b")\n',
      "a.ts": 'import { c } from "./c"\nexport const a = c\n',
      "b.ts": "export const b = 1\n",
      "c.ts": "export const c = 1\n",
      "gate.ts": 'import { a } from "./a"\n',
    })
    expect(producersOnly(root)).toEqual([at("a.ts"), at("b.ts"), at("c.ts"), OUTCOME_RUNNER])
  })

  test("#given a module the runner newly imports #then it joins the set without a list being edited", () => {
    const files = { "scenario-run.ts": "export {}\n", "normalize.ts": "export const normalize = 1\n" }
    expect(producersOnly(tree(files))).toEqual([OUTCOME_RUNNER])
    const moved = { ...files, "scenario-run.ts": 'import { normalize } from "./normalize"\n' }
    expect(producersOnly(tree(moved))).toEqual([at("normalize.ts"), OUTCOME_RUNNER])
  })

  test("#given a type-only import #then it is not a producer: a type cannot change an outcome", () => {
    const root = tree({
      "scenario-run.ts": 'import type { T } from "./types"\nimport { type U } from "./more-types"\n',
      "types.ts": "export type T = 1\n",
      "more-types.ts": "export type U = 1\n",
    })
    expect(producersOnly(root)).toEqual([OUTCOME_RUNNER])
  })

  test("#given this repository #then the runner, its scenario table and the tool registry it discovers tools with are producers", () => {
    const producers = outcomeProducers(REPO_ROOT)
    expect(producers).toEqual(expect.arrayContaining([OUTCOME_RUNNER, at("scenarios.ts"), at("tool-registry.ts")]))
    expect(producers).not.toContain(at("presentation.ts"))
  })

  test("#given re-exports, a bare side-effect import, a .js specifier, require() and a JSON module #then each is followed", () => {
    const root = tree({
      "scenario-run.ts":
        'export * from "./star"\nexport { x } from "./named"\nimport "./side"\nimport { j } from "./js-named.js"\nconst r = require("./req")\nimport data from "./data.json"\n',
      "star.ts": "export const s = 1\n",
      "named.ts": "export const x = 1\n",
      "side.ts": "globalThis.x = 1\n",
      "js-named.ts": "export const j = 1\n",
      "req.ts": "module.exports = 1\n",
      "data.json": "{}\n",
    })
    expect(producersOnly(root)).toEqual(
      ["data.json", "js-named.ts", "named.ts", "req.ts", "side.ts", "star.ts"]
        .map(at)
        .concat(OUTCOME_RUNNER)
        .toSorted(),
    )
  })

  test("#given a type-only re-export #then it is not followed", () => {
    expect(
      producersOnly(
        tree({ "scenario-run.ts": 'export type { T } from "./types"\n', "types.ts": "export type T = 1\n" }),
      ),
    ).toEqual([OUTCOME_RUNNER])
  })

  test("#given a relative import that resolves to no file, or a computed template import #then the computation fails", () => {
    expect(() => outcomeProducers(tree({ "scenario-run.ts": 'import { gone } from "./gone"\n' }))).toThrow(
      'cannot resolve the relative import "./gone"',
    )
    expect(() => outcomeProducers(tree({ "scenario-run.ts": "const m = await import(`./${name}`)\n" }))).toThrow(
      "cannot follow the computed import",
    )
  })

  test("#given any tree #then the files that compute and judge the tier are members by rule", () => {
    expect(outcomeProducers(tree({ "scenario-run.ts": "export {}\n" }))).toEqual(
      [...TIER_FILES, OUTCOME_RUNNER].toSorted(),
    )
  })

  test("#given a module the head stops importing #then the pull request's set still holds it, from the merge base's tree", () => {
    const base = tree({
      "scenario-run.ts": 'import { n } from "./normalize"\n',
      "normalize.ts": "export const n = 1\n",
    })
    const head = tree({ "scenario-run.ts": "export {}\n", "normalize.ts": "export const n = 1\n" })
    expect(gateChangeSet(head, base)).toContain(at("normalize.ts"))
    expect(outcomeProducers(head)).not.toContain(at("normalize.ts"))
  })

  // Tripwire on the entry's wiring: the gate receives the set of both trees, never a list of its own.
  test("#given the gate's command-line entry #then it passes the gate the set computed on the head and the merge base", async () => {
    const source = await Bun.file(new URL("./gate-cli.ts", import.meta.url)).text()
    expect(source).toContain("outcomeProducers: gateChangeSet(REPO_ROOT, baseTree),")
  })
})
