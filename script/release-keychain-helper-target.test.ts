/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { buildRuntimeManifest, RELEASE_BINARY_TARGETS, resolveExpectedSidecarRelPaths, stageSidecarPayload } from "./build-omo-binary"
import { KEYCHAIN_HELPER_PAYLOAD, KEYCHAIN_HELPER_SOURCE, keychainHelperPayload, stageKeychainHelper } from "./release-keychain-helper-target"

function withRoot(body: (root: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-keychain-target-"))
    try {
      await body(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

describe("keychain helper in the compiled release payload (#11262)", () => {
  test("every darwin target and no other target embeds the helper beside the runtime (execDir/omo-keychain, RULING-74)", () => {
    expect(KEYCHAIN_HELPER_PAYLOAD).toBe("omo-keychain")
    for (const target of RELEASE_BINARY_TARGETS) {
      const darwin = target.target.startsWith("darwin-")
      expect(keychainHelperPayload(target.target), target.target).toBe(darwin ? KEYCHAIN_HELPER_PAYLOAD : null)
      expect(resolveExpectedSidecarRelPaths(target).includes(KEYCHAIN_HELPER_PAYLOAD), target.target).toBe(darwin)
    }
  })

  test.skipIf(process.platform === "win32")("stages the helper with mode 0755 so the manifest carries the execute bit", withRoot(async (root) => {
    const source = join(root, KEYCHAIN_HELPER_SOURCE)
    mkdirSync(dirname(source), { recursive: true })
    writeFileSync(source, "signed helper")
    chmodSync(source, 0o644)
    const stageDir = join(root, "stage")

    expect(stageKeychainHelper("darwin-x64-baseline", stageDir, root)).toBe(KEYCHAIN_HELPER_PAYLOAD)
    const manifest = await buildRuntimeManifest(stageDir, { omoAiVersion: "1.0.0", enginePin: "test" })

    expect(readFileSync(join(stageDir, KEYCHAIN_HELPER_PAYLOAD), "utf8")).toBe("signed helper")
    expect(statSync(join(stageDir, KEYCHAIN_HELPER_PAYLOAD)).mode & 0o777).toBe(0o755)
    expect(manifest.entries).toEqual([expect.objectContaining({ relPath: KEYCHAIN_HELPER_PAYLOAD, mode: 0o755 })])
  }))

  test("a darwin target without the helper fails closed; other targets stage nothing", withRoot((root) => {
    const stageDir = join(root, "stage")
    expect(() => stageKeychainHelper("darwin-arm64", stageDir, root)).toThrow(/missing required keychain helper for darwin-arm64:/)
    expect(stageKeychainHelper("linux-x64", stageDir, root)).toBeNull()
    expect(existsSync(stageDir)).toBe(false)
  }))

  test("the release staging entry point refuses a darwin build without the helper", withRoot((root) => {
    const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "darwin-arm64")
    if (target === undefined) throw new Error("darwin-arm64 target expected")
    const engine = join(root, "target", "aarch64-apple-darwin", "release", "senpi-desktop-engine")
    mkdirSync(dirname(engine), { recursive: true })
    writeFileSync(engine, "engine")

    expect(() => stageSidecarPayload(target, join(root, "stage"), "1.0.0", undefined, root)).toThrow(/missing required keychain helper for darwin-arm64:/)
    expect(existsSync(join(root, "stage", "plugin"))).toBe(false)
  }))
})
