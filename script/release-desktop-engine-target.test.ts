import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import fixture from "./release-desktop-engine-fixture.json"
import {
  DESKTOP_ENGINE_TARGETS,
  desktopEngineTarget,
  loadDesktopEngineTargets,
  stageCompiledDesktopEngine,
} from "./release-desktop-engine-target"
import { buildRuntimeManifest, RELEASE_BINARY_TARGETS, resolveExpectedSidecarRelPaths, stageSidecarPayload } from "./build-omo-binary"

describe("desktop engine target fixture", () => {
  test("all twelve targets resolve from the fixture with explicit unavailable entries", () => {
    // Given the release fixture and binary matrix.
    const targets = loadDesktopEngineTargets(fixture)

    // When the fixture resolves to payload targets.
    const decisions = targets.map((entry) => entry.target)

    // Then every binary has exactly one availability decision.
    expect(decisions).toEqual(RELEASE_BINARY_TARGETS.map((entry) => entry.target))
    expect(targets).toEqual(DESKTOP_ENGINE_TARGETS)
    expect(targets.filter((entry) => entry.available).map((entry) => entry.target)).toEqual([
      "darwin-arm64", "darwin-x64", "darwin-x64-baseline",
      "linux-x64", "linux-x64-baseline", "windows-x64", "windows-x64-baseline",
    ])
    expect(targets.filter((entry) => !entry.available).every((entry) =>
      entry.host === null && entry.asset === null && entry.source === null && entry.payload === null,
    )).toBe(true)
  })

  test("missing, extra, and mismatched hosts are rejected rather than falling back", () => {
    // Given malformed copies of the complete fixture.
    const missing = structuredClone(fixture)
    const extra = structuredClone(fixture)
    const wrongHost = structuredClone(fixture)
    delete (missing.targets as Record<string, unknown>)["darwin-arm64"]
    ;(extra.targets as Record<string, unknown>)["surprise"] = { available: false, host: null }
    wrongHost.targets["darwin-arm64"].host = "darwin-x64"

    // When each fixture is parsed, then its distinct invalid shape fails.
    expect(() => loadDesktopEngineTargets(missing)).toThrow(/missing desktop engine target: darwin-arm64/)
    expect(() => loadDesktopEngineTargets(extra)).toThrow(/unexpected desktop engine target: surprise/)
    expect(() => loadDesktopEngineTargets(wrongHost)).toThrow(/cannot use darwin-x64/)
  })

  test("CLI outputs one JSON decision for an available baseline and an unavailable target", () => {
    // Given the query CLI and target names.
    const cli = join(import.meta.dir, "release-desktop-engine-target.ts")
    // When a workflow queries each target.
    const baseline = spawnSync("bun", [cli, "--target", "darwin-x64-baseline"], { encoding: "utf8" })
    const unavailable = spawnSync("bun", [cli, "--target", "linux-arm64"], { encoding: "utf8" })

    // Then the machine-consumed host, asset and Rust source are explicit.
    expect(baseline.status).toBe(0)
    expect(JSON.parse(baseline.stdout)).toEqual({
      target: "darwin-x64-baseline", available: true, host: "darwin-x64",
      asset: "senpi-desktop-engine-darwin-x64",
      source: "target/x86_64-apple-darwin/release/senpi-desktop-engine",
      payload: "native/prebuilds/darwin-x64/senpi-desktop-engine",
    })
    expect(unavailable.status).toBe(0)
    expect(JSON.parse(unavailable.stdout)).toEqual({
      target: "linux-arm64", available: false, host: null, asset: null, source: null, payload: null,
    })
    expect(spawnSync("bun", [cli, "--target", "surprise"], { encoding: "utf8" }).status).toBe(1)
  })
})

describe("compiled desktop engine staging", () => {
  test("stages only the exact target-specific Rust binary into the expected manifest path", async () => {
    // Given a Darwin cross-target binary and a different host-release binary.
    const root = mkdtempSync(join(tmpdir(), "omo-desktop-engine-target-"))
    try {
      const entry = desktopEngineTarget("darwin-x64-baseline")
      if (entry.source === null || entry.payload === null) throw new Error("available target expected")
      const source = join(root, entry.source)
      mkdirSync(dirname(source), { recursive: true })
      writeFileSync(source, "x64-rust-binary")
      chmodSync(source, 0o644)
      mkdirSync(join(root, "target", "release"), { recursive: true })
      writeFileSync(join(root, "target", "release", "senpi-desktop-engine"), "wrong-arch")
      const stageDir = join(root, "stage")

      // When staging this target's compiled executable.
      const staged = stageCompiledDesktopEngine("darwin-x64-baseline", stageDir, root)
      const manifest = await buildRuntimeManifest(stageDir, { omoAiVersion: "1.0.0", enginePin: "test" })

      // Then the declared payload, content and manifest executable bit agree.
      expect(staged).toBe(entry.payload)
      expect(resolveExpectedSidecarRelPaths(RELEASE_BINARY_TARGETS[2]!)).toContain(entry.payload)
      expect(readFileSync(join(stageDir, entry.payload), "utf8")).toBe("x64-rust-binary")
      if (process.platform !== "win32") expect(statSync(source).mode & 0o777).toBe(0o644)
      expect(manifest.entries).toEqual([expect.objectContaining({ relPath: entry.payload, mode: 0o755, size: 15 })])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("available missing target binary fails even if host release exists; unavailable stages nothing", () => {
    // Given only a generic release binary, not the required target-specific one.
    const root = mkdtempSync(join(tmpdir(), "omo-desktop-engine-missing-"))
    try {
      const fallback = join(root, "target", "release", "senpi-desktop-engine")
      mkdirSync(dirname(fallback), { recursive: true })
      writeFileSync(fallback, "wrong-arch")
      const stageDir = join(root, "stage")

      // When the declared available target is staged, then no fallback is accepted.
      expect(() => stageCompiledDesktopEngine("linux-x64", stageDir, root))
        .toThrow(/missing required desktop engine for linux-x64:.*x86_64-unknown-linux-gnu/)
      expect(existsSync(stageDir)).toBe(false)
      expect(stageCompiledDesktopEngine("linux-arm64", stageDir, root)).toBeNull()
      expect(existsSync(stageDir)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("the release builder refuses an available target without its compiled Rust payload", () => {
    // Given an isolated source root with no Windows Rust output, even when CI built one.
    const root = mkdtempSync(join(tmpdir(), "omo-desktop-builder-missing-"))
    try {
      const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "windows-x64")
      if (target === undefined) throw new Error("windows-x64 target expected")

      // When the actual release staging entry point is run.
      const stage = (): void => { stageSidecarPayload(target, join(root, "stage"), "1.0.0", undefined, root) }

      // Then a missing required compiled payload fails closed.
      expect(stage).toThrow(/missing required desktop engine for windows-x64:.*x86_64-pc-windows-msvc/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
