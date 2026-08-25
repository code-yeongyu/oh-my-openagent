import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nearestNodeBin } from "../bin/lib/package-paths.js"

const roots: string[] = []

type ShimName = "senpi" | "senpi.cmd" | "other"

type LayoutOptions = {
  /** Creates the empty node_modules/.bin npm materializes inside the scoped package (#6847). */
  scopedEmptyBin?: boolean
  /** Which shim the ancestor dependency bin holds. */
  ancestorShim?: ShimName
}

function createLayout(options: LayoutOptions = {}): { root: string; scopedPackageRoot: string; ancestorBin: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-package-paths-"))
  roots.push(root)
  const modulesRoot = join(root, "app", "node_modules")
  const scopedPackageRoot = join(modulesRoot, "@code-yeongyu", "senpi")
  mkdirSync(join(scopedPackageRoot, "dist"), { recursive: true })
  writeFileSync(join(scopedPackageRoot, "package.json"), "{}\n")
  writeFileSync(join(scopedPackageRoot, "dist", "cli.js"), "export {}\n")
  if (options.scopedEmptyBin) {
    // npm creates this directory for a scoped package's own transitive bins even when it stays empty.
    mkdirSync(join(scopedPackageRoot, "node_modules", ".bin"), { recursive: true })
  }
  const ancestorBin = join(modulesRoot, ".bin")
  const shim = options.ancestorShim
  if (shim) {
    mkdirSync(ancestorBin, { recursive: true })
    writeFileSync(join(ancestorBin, shim), "fixture shim\n", { mode: 0o755 })
  }
  return { root, scopedPackageRoot, ancestorBin }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("nearestNodeBin", () => {
  describe("#given a scoped package with its own empty .bin and an ancestor bin holding the senpi shim", () => {
    test("#when resolving from the scoped package root #then the ancestor bin wins over the empty scoped one", () => {
      // given - the exact npm layout from #6847
      const { scopedPackageRoot, ancestorBin } = createLayout({ scopedEmptyBin: true, ancestorShim: "senpi" })

      // when
      const resolved = nearestNodeBin(scopedPackageRoot, { executable: "senpi" })

      // then
      expect(resolved).toBe(ancestorBin)
    })

    test("#when resolving on win32 #then the ancestor bin holding senpi.cmd wins over the empty scoped one", () => {
      // given - npm ships .cmd shims on Windows; the decision must be simulated portably
      const { scopedPackageRoot, ancestorBin } = createLayout({ scopedEmptyBin: true, ancestorShim: "senpi.cmd" })

      // when
      const resolved = nearestNodeBin(scopedPackageRoot, { executable: "senpi", platform: "win32" })

      // then
      expect(resolved).toBe(ancestorBin)
    })

    test("#when resolving on win32 and only an extensionless shim exists #then no bin qualifies", () => {
      // given - the launcher spawns senpi.cmd on win32, so an extensionless shim cannot serve it
      const { scopedPackageRoot } = createLayout({ scopedEmptyBin: true, ancestorShim: "senpi" })

      // when
      const resolved = nearestNodeBin(scopedPackageRoot, { executable: "senpi", platform: "win32" })

      // then
      expect(resolved).toBeUndefined()
    })
  })

  describe("#given no bin in the ancestry contains the requested executable", () => {
    test("#when resolving #then it returns undefined instead of a shimless bin", () => {
      // given - both bins exist but hold only an unrelated tool
      const { scopedPackageRoot } = createLayout({ scopedEmptyBin: true, ancestorShim: "other" })

      // when
      const resolved = nearestNodeBin(scopedPackageRoot, { executable: "senpi" })

      // then
      expect(resolved).toBeUndefined()
    })
  })

  describe("#given no executable is requested", () => {
    test("#when resolving #then the first existing bin wins, preserving the legacy walk", () => {
      // given
      const { scopedPackageRoot } = createLayout({ scopedEmptyBin: true, ancestorShim: "senpi" })

      // when
      const resolved = nearestNodeBin(scopedPackageRoot)

      // then
      expect(resolved).toBe(join(scopedPackageRoot, "node_modules", ".bin"))
    })
  })

  describe("#given a hoisted layout where the engine package sits directly in node_modules", () => {
    test("#when resolving with an executable #then the sibling bin holding the shim is found", () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-package-paths-"))
      roots.push(root)
      const modulesRoot = join(root, "app", "node_modules")
      const hoistedPackageRoot = join(modulesRoot, "senpi")
      mkdirSync(hoistedPackageRoot, { recursive: true })
      const ancestorBin = join(modulesRoot, ".bin")
      mkdirSync(ancestorBin, { recursive: true })
      writeFileSync(join(ancestorBin, "senpi"), "fixture shim\n", { mode: 0o755 })

      // when
      const resolved = nearestNodeBin(hoistedPackageRoot, { executable: "senpi" })

      // then
      expect(resolved).toBe(ancestorBin)
    })
  })
})
