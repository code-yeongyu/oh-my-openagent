import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  ACCOUNT_CORE,
  ACCOUNT_CORE_RULES,
  ACCOUNT_LOGIC_MARKERS,
  EDITION_PACKAGE_NAMES,
} from "./remote-import-guard-account-rules"
import { checkAdapterImports, logicOutside, referenceSpecifiers } from "./remote-import-guard-adapter"
import { createResolver } from "./remote-import-guard-resolve"
import { type FileFacts, scanRepository } from "./remote-import-guard-scan"

// Family A, the account core's side (#14364, design 3.1 and 7.5): an architecture contract. packages/account-core
// depends on no edition package and no cli directory in any form: value or type import, re-export, dynamic import,
// require, a triple-slash reference or a type-position import query; and no file outside it holds the core's logic.

const REPO_ROOT = join(import.meta.dir, "..")
const repoFacts = scanRepository(REPO_ROOT)

function coreReach(root: string, facts: readonly FileFacts[]): Record<string, readonly string[]> {
  const resolve = createResolver(root)
  const found = new Map(checkAdapterImports(facts, resolve, ACCOUNT_CORE_RULES))
  for (const fact of facts) {
    if (!ACCOUNT_CORE_RULES.adapter(fact.file)) continue
    for (const specifier of referenceSpecifiers(readFileSync(join(root, fact.file), "utf8"))) {
      const target = resolve(fact.file, specifier) ?? specifier
      const layer = ACCOUNT_CORE_RULES.forbidden.find((prefix) => target.startsWith(prefix))
      if (layer !== undefined) found.set(fact.file, [...new Set([...(found.get(fact.file) ?? []), layer])].toSorted())
    }
  }
  return Object.fromEntries([...found].toSorted(([a], [b]) => a.localeCompare(b)))
}

const isNotLogic = (file: string): boolean =>
  /\.test\.[cm]?[jt]s$/.test(file) ||
  /(?:^|[/.-])(?:fixture|test-support)\b/.test(file) ||
  file.split("/").some((segment) => segment === "test" || segment === "testing")

describe("account core family A (#14364)", () => {
  test("#given every file of the account core, tests included #then none reaches an edition package or a cli directory in any form", () => {
    expect(repoFacts.some((fact) => fact.file.startsWith(ACCOUNT_CORE))).toBe(true)
    expect(coreReach(REPO_ROOT, repoFacts)).toEqual({})
  })

  test("#given the account core's manifest and tsconfig #then neither names an edition package or maps a path outside it", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages/account-core/package.json"), "utf8"))
    const named = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
      Object.keys(manifest[field] ?? {}),
    )
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((name) => (EDITION_PACKAGE_NAMES as readonly string[]).includes(name))).toEqual([])
    const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, "packages/account-core/tsconfig.json"), "utf8"))
    expect([tsconfig.compilerOptions?.paths, tsconfig.compilerOptions?.baseUrl, tsconfig.references, tsconfig.extends]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(tsconfig.include).toEqual(["src/**/*"])
  })

  test("#given every non-test source outside the account core #then none holds credential-store, device-key or device-code logic", () => {
    const sources = repoFacts
      .filter((fact) => !isNotLogic(fact.file))
      .map((fact) => ({ file: fact.file, text: readFileSync(join(REPO_ROOT, fact.file), "utf8") }))
    expect(Object.fromEntries(logicOutside(sources, ACCOUNT_CORE, ACCOUNT_LOGIC_MARKERS))).toEqual({})
    expect(logicOutside(sources, "packages/none/", ACCOUNT_LOGIC_MARKERS).size).toBeGreaterThan(0)
  })

  test("#given a core file that reaches an edition package in each form #then every form is named, and a clean file is not", () => {
    const root = mkdtempSync(join(tmpdir(), "account-core-guard-"))
    try {
      const put = (path: string, text: string): void => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
      }
      const cli = "../../omo-opencode/src/cli"
      put("packages/omo-opencode/src/cli/terminal.ts", "export const t = 1\n")
      put("packages/omo-opencode/src/cli/types.ts", "export type T = { readonly t: 1 }\n")
      put("packages/omo-senpi/package.json", '{"name":"@oh-my-opencode/omo-senpi","exports":{".":"./src/index.ts"}}')
      put("packages/omo-senpi/src/index.ts", "export type S = 1\n")
      const forms: Record<string, string> = {
        "export-from.ts": `export { t } from "${cli}/terminal.ts"\n`,
        "import-type.ts": `import type { T } from "${cli}/types.ts"\nexport const v: T = { t: 1 }\n`,
        "export-type.ts": `export type { T } from "${cli}/types.ts"\n`,
        "export-star.ts": `export * from "${cli}/terminal.ts"\n`,
        "dynamic.ts": `export const load = () => import("${cli}/terminal.ts")\n`,
        "required.ts": `export const m = require("${cli}/terminal.ts")\n`,
        "import-equals.ts": `import m = require("${cli}/terminal.ts")\nexport const n = m\n`,
        "triple-slash.ts": `/// <reference path="${cli}/types.ts" />\nexport const r = 1\n`,
        "type-query.ts": `export type Q = typeof import("${cli}/terminal.ts")\n`,
        "bare-package.ts": 'import type { S } from "@oh-my-opencode/omo-senpi"\nexport const b: S = 1\n',
        "through-helper.ts": 'import { t } from "./export-from.ts"\nexport const h = t\n',
        "clean.ts": "export const c = 1\n",
      }
      for (const [name, text] of Object.entries(forms)) put(`packages/account-core/src/${name}`, text)
      execFileSync("git", ["init", "-q"], { cwd: root })
      execFileSync("git", ["add", "packages"], { cwd: root })
      const expected = Object.fromEntries(
        Object.keys(forms)
          .filter((name) => name !== "clean.ts")
          .map((name) => [
            `packages/account-core/src/${name}`,
            [name === "bare-package.ts" ? "packages/omo-senpi/" : "packages/omo-opencode/"],
          ])
          .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
      )
      expect(coreReach(root, scanRepository(root))).toEqual(expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a marker outside the core #then the file and its kind are named; the same text inside the core is not", () => {
    const sources = [
      { file: "packages/omo-native/store.ts", text: 'spawn("secret-tool", ["lookup"])' },
      { file: "packages/omo-senpi/flow.ts", text: 'request("/v1/device/code")' },
      { file: `${ACCOUNT_CORE}keystore.ts`, text: 'spawn("secret-tool", ["store"])' },
      { file: "packages/omo-native/clean.ts", text: "export const clean = 1" },
    ]
    expect(Object.fromEntries(logicOutside(sources, ACCOUNT_CORE, ACCOUNT_LOGIC_MARKERS))).toEqual({
      "packages/omo-native/store.ts": ["credential store or device keys"],
      "packages/omo-senpi/flow.ts": ["device-code flow"],
    })
  })
})
