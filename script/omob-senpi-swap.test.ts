// Contract: an omob build bundles exactly one senpi engine. A second copy splits the engine's module-scoped
// adopted-trust record, so a coordinated host start loses its startup pipe (supervisor_bootstrap timeout).

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { placeBuiltSenpi, senpiResolutionPaths } from "./omob-senpi-swap"

function writeEngine(directory: string, version: string): void {
  mkdirSync(join(directory, "dist"), { recursive: true })
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version }))
  writeFileSync(join(directory, "dist", "cli.js"), `export const version = ${JSON.stringify(version)}\n`)
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}

/** The layout bun's isolated linker leaves: workspaces link a store entry; an earlier omob swap left a real root copy. */
function isolatedLinkerClone(root: string): { omoDir: string; built: string } {
  const omoDir = join(root, "omo")
  const store = join(omoDir, "node_modules", ".bun", "@code-yeongyu+senpi@2026.11.15-2+abc", "node_modules")
  writeEngine(join(store, "@code-yeongyu", "senpi"), "registry")
  link(
    join(store, "@code-yeongyu", "senpi"),
    join(omoDir, "node_modules", ".bun", "node_modules", "@code-yeongyu", "senpi"),
  )
  for (const workspace of ["omo-native", "omo-senpi", "senpi-task"])
    link(
      join(store, "@code-yeongyu", "senpi"),
      join(omoDir, "packages", workspace, "node_modules", "@code-yeongyu", "senpi"),
    )
  writeEngine(join(omoDir, "node_modules", "@code-yeongyu", "senpi"), "previous-swap")
  const built = join(root, "built")
  writeEngine(built, "source-build")
  return { omoDir, built }
}

describe("placeBuiltSenpi", () => {
  test("#given workspaces linked to a registry store copy #when the built engine is placed #then every resolution reaches that one built copy", () => {
    const root = mkdtempSync(join(tmpdir(), "omob-senpi-swap-"))
    try {
      const { omoDir, built } = isolatedLinkerClone(root)
      const target = placeBuiltSenpi(omoDir, built)
      const canonical = realpathSync(target)
      const paths = senpiResolutionPaths(omoDir)
      expect(paths.length).toBe(6)
      for (const path of paths) {
        expect(realpathSync(path)).toBe(canonical)
        expect(JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version).toBe("source-build")
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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

  test("#given a workspace resolution linked to an engine outside the clone #when the built engine is placed #then it refuses naming the path and the outside engine survives", () => {
    const root = mkdtempSync(join(tmpdir(), "omob-senpi-swap-outside-"))
    try {
      const { omoDir, built } = isolatedLinkerClone(root)
      const outside = join(root, "outside-cache", "senpi")
      writeEngine(outside, "outside")
      const escaping = join(omoDir, "packages", "omo-senpi", "node_modules", "@code-yeongyu", "senpi")
      rmSync(escaping)
      link(outside, escaping)
      expect(() => placeBuiltSenpi(omoDir, built)).toThrow(escaping)
      expect(JSON.parse(readFileSync(join(outside, "package.json"), "utf8")).version).toBe("outside")
      expect(realpathSync(escaping)).toBe(realpathSync(outside))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
