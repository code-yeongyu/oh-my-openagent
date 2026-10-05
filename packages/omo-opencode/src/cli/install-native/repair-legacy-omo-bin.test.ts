/// <reference types="bun-types" />

import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { legacyOmoBins, scanOmoBins } from "./legacy-omo-bin"
import { repairLegacyOmoBins } from "./repair-legacy-omo-bin"
import { createBinFixtureRoot, writeCodexLightRuntimeWrapper, writeGlobalPackageBin } from "./omo-bin-test-fixtures"

const roots: string[] = []

function root(label: string): string {
  const created = createBinFixtureRoot(label)
  roots.push(created)
  return created
}

afterEach(() => {
  while (roots.length > 0) {
    const created = roots.pop() as string
    chmodSync(join(created, "bin"), 0o755)
    rmSync(created, { recursive: true, force: true })
  }
})

function environmentOf(pathDirectories: readonly string[]) {
  return { pathDirectories, extraDirectories: [], isWindows: false }
}

describe("repairLegacyOmoBins", () => {
  test("#given a legacy omo shim #when repairing #then only that shim is removed and the package keeps its own commands", () => {
    // given
    const npm = writeGlobalPackageBin({
      root: root("repair-legacy"),
      packageName: "oh-my-openagent",
      version: "4.19.4",
      bins: ["omo", "oh-my-openagent", "lazycodex"],
    })
    const entries = scanOmoBins(environmentOf([npm.binDir]))

    // when
    const repair = repairLegacyOmoBins(legacyOmoBins(entries), { isWindows: false })

    // then
    expect(existsSync(npm.binPath)).toBe(false)
    expect(existsSync(join(npm.binDir, "oh-my-openagent"))).toBe(true)
    expect(existsSync(join(npm.binDir, "lazycodex"))).toBe(true)
    expect(existsSync(join(npm.packageDir, "package.json"))).toBe(true)
    expect(repair.removed).toEqual([
      { binPath: npm.binPath, packageName: "oh-my-openagent", packageVersion: "4.19.4" },
    ])
    expect(repair.failures).toEqual([])
    expect(repair.notes.join("\n")).toContain("oh-my-openagent@4.19.4")
    expect(repair.notes.join("\n")).toContain(npm.binPath)
  })

  test("#given nothing legacy is installed #when repairing #then nothing is removed and nothing is reported", () => {
    // given
    const bun = writeGlobalPackageBin({ root: root("repair-none"), packageName: "omo-ai", version: "5.0.0-0.beta.89" })
    const entries = scanOmoBins(environmentOf([bun.binDir]))

    // when
    const repair = repairLegacyOmoBins(legacyOmoBins(entries), { isWindows: false })

    // then
    expect(existsSync(bun.binPath)).toBe(true)
    expect(repair.removed).toEqual([])
    expect(repair.notes).toEqual([])
    expect(repair.warnings).toEqual([])
  })

  // chmod-based write denial is POSIX-only: Windows ignores the mode bits, so the unlink succeeds there.
  test.skipIf(process.platform === "win32")("#given the bin directory cannot be written #when repairing #then the failure is reported with the manual command", () => {
    // given
    const npm = writeGlobalPackageBin({ root: root("repair-denied"), packageName: "oh-my-opencode", version: "4.19.4" })
    const entries = legacyOmoBins(scanOmoBins(environmentOf([npm.binDir])))
    chmodSync(npm.binDir, 0o500)

    // when
    const repair = repairLegacyOmoBins(entries, { isWindows: false })

    // then
    expect(existsSync(npm.binPath)).toBe(true)
    expect(repair.removed).toEqual([])
    expect(repair.failures).toHaveLength(1)
    expect(repair.warnings.join("\n")).toContain(npm.binPath)
    expect(repair.warnings.join("\n")).toContain("npm uninstall -g oh-my-opencode")
  })
})

describe("repairLegacyOmoBins with a Codex Light runtime wrapper", () => {
  test("#given a legacy Codex Light omo wrapper #when repairing #then the wrapper is removed and reported with its version", () => {
    // given
    const light = writeCodexLightRuntimeWrapper({ root: root("repair-light"), version: "4.19.4" })
    mkdirSync(join(light.binDir, "..", "..", "bin"), { recursive: true })
    const entries = scanOmoBins(environmentOf([light.binDir]))

    // when
    const repair = repairLegacyOmoBins(legacyOmoBins(entries), { isWindows: false })

    // then
    expect(existsSync(light.binPath)).toBe(false)
    expect(repair.removed).toEqual([{ binPath: light.binPath, packageName: "lazycodex", packageVersion: "4.19.4" }])
    expect(repair.notes.join("\n")).toContain("lazycodex@4.19.4")
  })
})
