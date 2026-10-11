import { afterEach, describe, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DesktopEngineUnavailableError } from "@oh-my-opencode/senpi-desktop-service"

import { defaultEngineChild, describeEngineSource, omoReleaseVersion } from "./engine-source"

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
  test("#given a sidecar #when described #then status names its source without starting it", () => {
    const root = packageDir({ name: "omo", version: "5.1.4" })
    const sidecar = join(root, "bin", "native", "prebuilds", "darwin-arm64", "senpi-desktop-engine")
    mkdirSync(dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, "engine")
    chmodSync(sidecar, 0o755)
    expect(describeEngineSource(undefined, {}, {
      platform: "darwin", arch: "arm64", execDir: join(root, "bin"),
      repoRoot: root, packageDir: root, isQuarantined: () => false,
    })).toBe(`found ${sidecar} (sidecar)`)
  })

  test("#given a verified cache and no candidate #when described #then status names the release cache", () => {
    const root = packageDir({ name: "omo", version: "5.1.4" })
    const bytes = Buffer.from("cached engine")
    const digest = createHash("sha256").update(bytes).digest("hex")
    const generation = join(root, ".omo", "cache", "senpi-desktop-engine", "5.1.4", "darwin-arm64", `${digest}-${randomUUID()}`)
    mkdirSync(generation, { recursive: true })
    const cached = join(generation, "senpi-desktop-engine-darwin-arm64")
    writeFileSync(cached, bytes)
    chmodSync(cached, 0o755)
    expect(describeEngineSource(undefined, { HOME: root, OMO_PACKAGE_DIR: root }, {
      platform: "darwin", arch: "arm64", execDir: join(root, "empty"), repoRoot: root, packageDir: root,
    })).toBe(`found ${cached} (cache, omo v5.1.4)`)
  })

  test("#given an empty installation #when described #then status names what first use would download", () => {
    const root = packageDir({ name: "omo", version: "5.1.4" })
    expect(describeEngineSource(undefined, { HOME: root, OMO_PACKAGE_DIR: root }, {
      platform: "darwin", arch: "arm64", execDir: root, repoRoot: root, packageDir: root,
    })).toBe("would download senpi-desktop-engine-darwin-arm64 from omo v5.1.4 on first use")
  })

  test.each(["linux", "win32"])("#given no release engine for %s-arm64 #when first use starts #then the diagnostic names the unsupported host", (platform) => {
    const root = packageDir({})
    const options = { platform, arch: "arm64", execDir: root, packageDir: root, repoRoot: root, runtimeDir: "" }
    expect(describeEngineSource(undefined, {}, options)).toBe(`No senpi-desktop-engine is built for ${platform}-arm64; computer use is unavailable on this host.`)
    const start = defaultEngineChild({}, options)(undefined)
    try {
      start()
      throw new Error("missing engine must fail")
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopEngineUnavailableError)
      if (!(error instanceof DesktopEngineUnavailableError)) throw error
      expect(error.diagnostic).toMatchObject({ host: `${platform}-arm64`, reason: "no-release-asset" })
    }
  })

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
