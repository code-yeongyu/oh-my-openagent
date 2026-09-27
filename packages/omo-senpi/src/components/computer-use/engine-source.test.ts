import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DesktopEngineUnavailableError } from "@oh-my-opencode/senpi-desktop-service"

import { defaultEngineChild, omoReleaseVersion } from "./engine-source"

const roots: string[] = []

function packageDir(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "omo-engine-source-"))
  roots.push(root)
  mkdirSync(join(root, "bin"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest))
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo release version for engine acquisition", () => {
  test("#given the compiled runtime's stamped manifest #when resolved #then its version names the release", () => {
    const runtime = packageDir({ name: "omo", version: "5.0.2" })
    expect(omoReleaseVersion({ OMO_PACKAGE_DIR: runtime })).toBe("5.0.2")
  })

  test("#given the npm launcher's omo-ai package #when resolved #then the omo-ai version names the release", () => {
    const npm = packageDir({ name: "omo-ai", version: "5.0.2-beta.1" })
    expect(omoReleaseVersion({ OMO_BIN: join(npm, "bin", "omo.js") })).toBe("5.0.2-beta.1")
  })

  test("#given a foreign package at either path #when resolved #then no release is named", () => {
    const senpi = packageDir({ name: "@code-yeongyu/senpi", version: "2026.9.27-2" })
    expect(omoReleaseVersion({ OMO_PACKAGE_DIR: senpi, OMO_BIN: join(senpi, "bin", "omo.js") })).toBeUndefined()
  })

  test("#given no omo launch #when resolved #then no release is named", () => {
    expect(omoReleaseVersion({})).toBeUndefined()
  })

  test("#given an explicit missing engine path #when the child factory starts #then it fails as native-unavailable before spawning", () => {
    const missing = join(tmpdir(), `missing-senpi-desktop-engine-${process.pid}`)
    const createChild = defaultEngineChild({})(missing)

    try {
      createChild()
      throw new Error("expected the explicit missing engine to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopEngineUnavailableError)
      if (!(error instanceof DesktopEngineUnavailableError)) throw error
      expect(error.diagnostic.code).toBe("native-unavailable")
      expect(error.diagnostic.attemptedPaths).toEqual([missing])
    }
  })
})
