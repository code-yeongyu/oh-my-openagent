import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Source tests share one lazy-module instance; built entries do not. Inspect the emitted bundles so
// minification cannot silently remove a loader and collapse its accessor into an unconditional
// throw (the beta.20 omo-task.js regression: issues #7339/#7340/#7351).
const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const extensionsDir = join(packageRoot, "plugin", "extensions")

const BUNDLE_FILES = [
  "omo.js",
  "omo-task.js",
  "omo-member.js",
  "omo-memory-mcp.js",
  "memory-run-supervisor.mjs",
  "omo-init-deep-advisor.js",
] as const

type LazyBarrel = {
  readonly label: string
  readonly specifier: string
  readonly guardMessage: string
}

// Keep aligned with packages/senpi-task/src/lazy/*.ts.
const LAZY_BARRELS: readonly LazyBarrel[] = [
  {
    label: "pi-tui",
    specifier: "@earendil-works/pi-tui",
    guardMessage: "The @earendil-works/pi-tui barrel was accessed before it was loaded",
  },
  {
    label: "senpi",
    specifier: "@code-yeongyu/senpi",
    guardMessage: "The @code-yeongyu/senpi barrel was accessed before it was loaded",
  },
]

describe("built bundles keep their lazy barrels loadable", () => {
  it("keeps omo-task's pi-tui warm-up in the published artifact (#7355)", () => {
    const taskBundle = readBundle("omo-task.js")
    expect(countDynamicImports(taskBundle, "@earendil-works/pi-tui")).toBeGreaterThan(0)
    expect(findUnconditionalGuard(taskBundle, LAZY_BARRELS[0].guardMessage)).toBeUndefined()
  })

  for (const barrel of LAZY_BARRELS) {
    it(`#given a built bundle reaching the ${barrel.label} barrel #when the artifact is inspected #then its dynamic import survived minification`, () => {
      const reaching = readBundlesReaching(barrel.guardMessage)
      expect(reaching.length, `no built bundle contains the ${barrel.label} barrel guard`).toBeGreaterThan(0)
      for (const { file, source } of reaching) {
        expect(
          countDynamicImports(source, barrel.specifier),
          `${file} reaches the ${barrel.label} barrel guard but has no import("${barrel.specifier}"), so the barrel can never load and every accessor call throws`,
        ).toBeGreaterThan(0)
      }
    })

    it(`#given a built bundle reaching the ${barrel.label} barrel #when the guard is inspected #then it is conditional, not an unconditional throw`, () => {
      const reaching = readBundlesReaching(barrel.guardMessage)
      expect(reaching.length, `no built bundle contains the ${barrel.label} barrel guard`).toBeGreaterThan(0)
      for (const { file, source } of reaching) {
        const unconditional = findUnconditionalGuard(source, barrel.guardMessage)
        expect(
          unconditional,
          `${file} collapsed the ${barrel.label} barrel guard into an unconditional throw: ${unconditional ?? ""}`,
        ).toBeUndefined()
      }
    })
  }
})

function readBundle(file: string): string {
  const path = join(extensionsDir, file)
  expect(existsSync(path), `missing built bundle at ${path}; run build:senpi-plugin first`).toBe(true)
  return readFileSync(path, "utf8")
}

function readBundlesReaching(guardMessage: string): readonly { file: string; source: string }[] {
  const reaching: { file: string; source: string }[] = []
  for (const file of BUNDLE_FILES) {
    const source = readBundle(file)
    if (source.includes(guardMessage)) reaching.push({ file, source })
  }
  return reaching
}

function countDynamicImports(source: string, specifier: string): number {
  const pattern = new RegExp(`\\bimport\\s*\\(\\s*["']${escapeForRegExp(specifier)}["']\\s*\\)`, "g")
  return [...source.matchAll(pattern)].length
}

function findUnconditionalGuard(source: string, guardMessage: string): string | undefined {
  const pattern = new RegExp(
    `function\\s+[A-Za-z_$][\\w$]*\\s*\\(\\s*\\)\\s*\\{\\s*throw\\s+(?:new\\s+)?Error\\(\\s*["'][^"']*${escapeForRegExp(guardMessage)}`,
    "u",
  )
  return pattern.exec(source)?.[0]
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")
}
