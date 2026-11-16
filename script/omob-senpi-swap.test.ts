// Contract: an omob build bundles exactly one senpi engine. A second copy splits the engine's module-scoped
// adopted-trust record, so a coordinated host start loses its startup pipe (supervisor_bootstrap timeout).

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { leavesClone, placeBuiltSenpi, senpiResolutionPaths } from "./omob-senpi-swap"

function writeEngine(directory: string, version: string): void {
  mkdirSync(join(directory, "dist"), { recursive: true })
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version }))
  writeFileSync(join(directory, "dist", "cli.js"), `export const version = ${JSON.stringify(version)}\n`)
}

function engineVersion(directory: string): string {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}

/**
 * How the root `node_modules/@code-yeongyu/senpi` looks when omob runs:
 * - "first-run": bun's link into the registry store entry, never swapped;
 * - "previous-swap": the real copy an earlier omob swap left;
 * - "relinked-after-swap": a later `bun install` linked the root back to the store entry, which the earlier swap
 *   had turned into a link to the root, so the two links form a cycle.
 */
type RootLayout = "first-run" | "previous-swap" | "relinked-after-swap"

/** The layout bun's isolated linker leaves: the hoisted alias and every workspace link one registry store entry. */
function isolatedLinkerClone(root: string, rootLayout: RootLayout): { omoDir: string; built: string; store: string } {
  const omoDir = join(root, "omo")
  const store = join(omoDir, "node_modules", ".bun", "@code-yeongyu+senpi@2026.11.15-2+abc", "node_modules")
  const storeEngine = join(store, "@code-yeongyu", "senpi")
  const rootEngine = join(omoDir, "node_modules", "@code-yeongyu", "senpi")
  if (rootLayout === "relinked-after-swap") link(rootEngine, storeEngine)
  else writeEngine(storeEngine, "registry")
  link(storeEngine, join(omoDir, "node_modules", ".bun", "node_modules", "@code-yeongyu", "senpi"))
  for (const workspace of ["omo-native", "omo-senpi", "senpi-task"])
    link(storeEngine, join(omoDir, "packages", workspace, "node_modules", "@code-yeongyu", "senpi"))
  if (rootLayout === "previous-swap") writeEngine(rootEngine, "previous-swap")
  else link(storeEngine, rootEngine)
  const built = join(root, "built")
  writeEngine(built, "source-build")
  return { omoDir, built, store: storeEngine }
}

describe("placeBuiltSenpi", () => {
  test.each<RootLayout>(["first-run", "previous-swap", "relinked-after-swap"])(
    "#given workspaces linked to a registry store entry and a %s root #when the built engine is placed #then every resolution reaches that one built copy",
    (rootLayout) => {
      const root = mkdtempSync(join(tmpdir(), "omob-senpi-swap-"))
      try {
        const { omoDir, built } = isolatedLinkerClone(root, rootLayout)
        const target = placeBuiltSenpi(omoDir, built)
        const canonical = realpathSync(target)
        expect(canonical).toBe(realpathSync(join(omoDir, "node_modules", "@code-yeongyu", "senpi")))
        const paths = senpiResolutionPaths(omoDir)
        expect(paths.length).toBe(6)
        for (const path of paths) {
          expect(realpathSync(path)).toBe(canonical)
          expect(engineVersion(path)).toBe("source-build")
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  test("#given a clone whose root is the only senpi #when the built engine is placed twice #then the root holds the build and nothing else resolves", () => {
    const root = mkdtempSync(join(tmpdir(), "omob-senpi-swap-root-"))
    try {
      const omoDir = join(root, "omo")
      writeEngine(join(omoDir, "node_modules", "@code-yeongyu", "senpi"), "registry")
      const built = join(root, "built")
      writeEngine(built, "source-build")
      placeBuiltSenpi(omoDir, built)
      const target = placeBuiltSenpi(omoDir, built)
      expect(senpiResolutionPaths(omoDir)).toEqual([target])
      expect(readFileSync(join(target, "dist", "cli.js"), "utf8")).toContain("source-build")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([
    ["an engine outside the clone", (root: string) => join(root, "outside-cache", "senpi")],
    ["the clone root itself", (root: string) => join(root, "omo")],
    ["the clone's parent", (root: string) => root],
  ])(
    "#given a workspace resolution linked to %s #when the built engine is placed #then it refuses naming the path before anything is deleted",
    (_name, escapeTarget) => {
      const root = mkdtempSync(join(tmpdir(), "omob-senpi-swap-outside-"))
      try {
        const { omoDir, built, store } = isolatedLinkerClone(root, "previous-swap")
        const outside = escapeTarget(root)
        writeEngine(outside, "outside")
        const escaping = join(omoDir, "packages", "omo-senpi", "node_modules", "@code-yeongyu", "senpi")
        rmSync(escaping)
        link(outside, escaping)
        expect(() => placeBuiltSenpi(omoDir, built)).toThrow(escaping)
        expect(engineVersion(outside)).toBe("outside")
        expect(realpathSync(escaping)).toBe(realpathSync(outside))
        const rootEngine = join(omoDir, "node_modules", "@code-yeongyu", "senpi")
        expect(engineVersion(rootEngine)).toBe("previous-swap")
        const untouched = senpiResolutionPaths(omoDir).filter((path) => path !== escaping && path !== rootEngine)
        expect(untouched.length).toBe(4)
        for (const path of untouched) {
          expect(realpathSync(path)).toBe(realpathSync(store))
          expect(engineVersion(path)).toBe("registry")
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

describe("leavesClone", () => {
  test.each([
    ["", true],
    ["..", true],
    [`..${sep}outside`, true],
    [resolve(sep, "another-drive", "senpi"), true],
    [join("node_modules", ".bun", "senpi"), false],
    [`..senpi${sep}cache`, false],
  ])("#given %p relative to the clone root #then leaving the clone is %p", (fromClone, expected) => {
    expect(leavesClone(fromClone)).toBe(expected)
  })
})
