import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createLaunch,
  ENGINE_CHECKSUMS_ASSET,
  EngineLaunchRefused,
  releaseAssetName,
  verifyDesignatedRequirement,
} from "../src/index.ts"

const host = "linux-x64"
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-computer-engine-trust-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex")

/** A packaged prebuild: `native/prebuilds/<host>/omo-computer-engine` beside the checksums file. */
function stagePrebuild(bytes: string, checksumOf: string): string {
  const prebuilds = join(root, "package", "native", "prebuilds")
  mkdirSync(join(prebuilds, host), { recursive: true })
  const engine = join(prebuilds, host, "omo-computer-engine")
  writeFileSync(engine, bytes)
  chmodSync(engine, 0o755)
  writeFileSync(join(prebuilds, ENGINE_CHECKSUMS_ASSET), `${sha256(checksumOf)}  ${releaseAssetName(host)}\n`)
  return engine
}

function launchFor(spawned: string[], platform = "linux", runCodesign = () => 0) {
  return createLaunch({
    locator: {
      platform,
      arch: "x64",
      libc: "glibc",
      runtimeDir: "",
      execDir: join(root, "bin"),
      packageDir: join(root, "package"),
      repoRoot: join(root, "repo"),
    },
    stableDir: join(root, "stable"),
    runCodesign,
    spawnEngine: (path) => {
      spawned.push(path)
      return { pid: 4242, path }
    },
  })
}

describe("launch trust", () => {
  it("checksum_mismatch_refuses_launch", async () => {
    // Given a prebuild whose bytes differ from the digest its checksums file records.
    stagePrebuild("#!/bin/sh\necho tampered\n", "#!/bin/sh\necho shipped\n")
    const spawned: string[] = []

    // When a host launches the engine through the factory.
    const attempt = launchFor(spawned)(["--version"], { env: {} })

    // Then the launch is refused for the checksum and nothing was spawned.
    await expect(attempt).rejects.toBeInstanceOf(EngineLaunchRefused)
    await expect(attempt).rejects.toMatchObject({ reason: "checksum_mismatch", host })
    expect(spawned).toEqual([])
  })

  it("a matching checksum launches the stable copy, never the located file", async () => {
    // Given a prebuild whose checksum matches.
    const located = stagePrebuild("#!/bin/sh\necho shipped\n", "#!/bin/sh\necho shipped\n")
    const spawned: string[] = []

    // When the factory launches it.
    const child = await launchFor(spawned)(["--version"], { env: {} })

    // Then exactly one spawn ran, at the stable path, with the verified digest.
    expect(spawned).toEqual([join(root, "stable", host, "omo-computer-engine")])
    expect(spawned[0]).not.toBe(located)
    expect(child).toMatchObject({ sha256: sha256("#!/bin/sh\necho shipped\n"), host })
  })

  it("designated_requirement_mismatch_refuses_launch", async () => {
    // Given a macOS prebuild with a matching checksum whose signature fails the designated requirement.
    const darwinHost = "darwin-arm64"
    const prebuilds = join(root, "package", "native", "prebuilds")
    mkdirSync(join(prebuilds, darwinHost), { recursive: true })
    writeFileSync(join(prebuilds, darwinHost, "omo-computer-engine"), "macho")
    chmodSync(join(prebuilds, darwinHost, "omo-computer-engine"), 0o755)
    writeFileSync(join(prebuilds, ENGINE_CHECKSUMS_ASSET), `${sha256("macho")}  ${releaseAssetName(darwinHost)}\n`)
    const spawned: string[] = []
    const codesignCalls: string[][] = []
    const launch = createLaunch({
      locator: {
        platform: "darwin",
        arch: "arm64",
        runtimeDir: "",
        execDir: join(root, "bin"),
        packageDir: join(root, "package"),
        repoRoot: join(root, "repo"),
        isQuarantined: () => false,
      },
      stableDir: join(root, "stable"),
      runCodesign: (args) => {
        codesignCalls.push([...args])
        return 3
      },
      spawnEngine: (path) => {
        spawned.push(path)
        return { pid: 1, path }
      },
    })

    // When a host launches it.
    const attempt = launch(["--version"], { env: {} })

    // Then the refusal names the designated requirement, codesign checked the staged copy, nothing spawned.
    await expect(attempt).rejects.toMatchObject({ reason: "designated_requirement_mismatch", host: darwinHost })
    expect(codesignCalls).toHaveLength(1)
    expect(codesignCalls[0]?.join(" ")).toContain("--verify --strict")
    expect(spawned).toEqual([])
  })

  it("the designated requirement is checked on macOS only and fails closed when codesign cannot run", () => {
    // Given the three platforms and a codesign runner that cannot start.
    const failing = () => null

    // When the check runs on each.
    // Then macOS refuses, every other platform has no designated requirement to check.
    expect(verifyDesignatedRequirement("/x", { platform: "darwin", runCodesign: failing })).toBe("mismatch")
    expect(verifyDesignatedRequirement("/x", { platform: "linux", runCodesign: failing })).toBe("not_applicable")
    expect(verifyDesignatedRequirement("/x", { platform: "win32", runCodesign: failing })).toBe("not_applicable")
  })
})
