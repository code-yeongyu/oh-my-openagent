import { describe, expect, test } from "bun:test"

import { blankModuleSpecifiers, type IdentitySides, specifierIdentity } from "./remote-import-guard-move-identity"

// Architecture contract (#14364, design lane ruling on review 6065350035): a moved file's changed specifier must name the
// same module: the same file, its moved counterpart, or one checked hop through a pure re-export.

describe("blankModuleSpecifiers", () => {
  const before = [
    'import { a } from "../cli/service-auth/a"',
    'import type { B } from "./b"',
    'export * from "./c"',
    'import "./side-effect"',
    'const d = await import("./d")',
    'const e = require("./e")',
    'const label = "kept"',
  ].join("\n")

  test("#given a file whose only change is every kind of module specifier #then both sides compare equal", () => {
    const after = before
      .replace("../cli/service-auth/a", "../../account-core/src/a")
      .replace('"./b"', '"../b"')
      .replace('"./c"', '"./core/c"')
      .replace('"./side-effect"', '"../side-effect"')
      .replace('"./d"', '"./x/d"')
      .replace('"./e"', '"./x/e"')
    expect(blankModuleSpecifiers(after)).toBe(blankModuleSpecifiers(before))
  })

  test("#given the same file with one statement changed #then the sides differ", () => {
    expect(blankModuleSpecifiers(before.replace('"kept"', '"changed"'))).not.toBe(blankModuleSpecifiers(before))
  })
})

describe("specifierIdentity", () => {
  const from = "old/a.ts"
  const to = "new/a.ts"
  const before = 'import { run, stop } from "./shim"\nexport const go = () => run(stop)\n'
  const after = 'import { run, stop } from "@pkg/runtime"\nexport const go = () => run(stop)\n'
  // The base side resolves the old specifier to old/shim.ts and the shim's own specifier to pkg/runtime.ts; the head side
  // resolves the new specifier to whatever `target` names.
  const sides = (shim: string, target: string, pairs: Readonly<Record<string, string>> = {}): IdentitySides => ({
    resolveBase: (file, specifier) =>
      file === from && specifier === "./shim" ? "old/shim.ts" : `pkg/${specifier.slice(2)}.ts`,
    resolveHead: () => target,
    readBase: (path) => (path === "old/shim.ts" ? shim : undefined),
    pairs,
  })

  test("#given a changed specifier that names the base target's moved counterpart #then it passes", () => {
    const result = specifierIdentity(
      from,
      to,
      before,
      after,
      sides("", "new/shim.ts", { "old/shim.ts": "new/shim.ts" }),
    )
    expect(result).toEqual({ problems: [], hops: [] })
  })

  test("#given a base target that is only a star export of the new module #then it passes as the one recorded hop", () => {
    const result = specifierIdentity(from, to, before, after, sides('export * from "./runtime"\n', "pkg/runtime.ts"))
    expect(result).toEqual({ problems: [], hops: [`${to}: "./shim" -> "@pkg/runtime" through old/shim.ts`] })
  })

  test("#given a changed specifier pointing at a different module with the same export names #then it fails", () => {
    const result = specifierIdentity(from, to, before, after, sides('export * from "./runtime"\n', "pkg/other.ts"))
    expect(result.problems).toEqual([
      `${to}: "./shim" -> "@pkg/runtime" resolves to pkg/other.ts, not old/shim.ts, its moved counterpart or the module it purely re-exports`,
    ])
  })

  test("#given a base target that re-exports the module AND holds one other statement #then it does not qualify", () => {
    const shim = 'export { run, stop } from "./runtime"\nexport const extra = 1\n'
    expect(specifierIdentity(from, to, before, after, sides(shim, "pkg/runtime.ts")).problems).toHaveLength(1)
  })

  test("#given a base target whose re-export renames a name the moved file imports #then it does not qualify", () => {
    const shim = 'export { run, halt as stop } from "./runtime"\n'
    expect(specifierIdentity(from, to, before, after, sides(shim, "pkg/runtime.ts")).problems).toHaveLength(1)
  })

  test("#given a base target that re-exports each imported name under its own name #then it passes", () => {
    const shim = 'export { run, stop, type Other } from "./runtime"\n'
    expect(specifierIdentity(from, to, before, after, sides(shim, "pkg/runtime.ts")).problems).toEqual([])
  })
})
