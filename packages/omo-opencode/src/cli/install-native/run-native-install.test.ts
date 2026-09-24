/// <reference types="bun-types" />

import { existsSync, rmSync } from "node:fs"
import { afterEach, describe, expect, test } from "bun:test"
import {
  NATIVE_RECOMMENDED_RUNTIME_NOTE,
  NATIVE_SETUP_COMMAND,
  nativeInstallFailureLines,
  nativeInstallSuccessLine,
  runNativeInstall,
} from "./index"
import type { NativeInstallSpawnResult, OmoBinEnvironment } from "./index"
import { createBinFixtureRoot, writeGlobalPackageBin } from "./omo-bin-test-fixtures"

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
}

const roots: string[] = []

function root(label: string): string {
  const created = createBinFixtureRoot(label)
  roots.push(created)
  return created
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

function environmentOf(pathDirectories: readonly string[]): OmoBinEnvironment {
  return { pathDirectories, extraDirectories: [], isWindows: false }
}

function emptyEnvironment(): OmoBinEnvironment {
  return environmentOf([root("empty")])
}

const probeMissing = async () => ({ exitCode: 127, stdout: "" })

function recordingSpawn(result: NativeInstallSpawnResult | (() => never), onSpawn?: () => void) {
  const calls: SpawnCall[] = []
  const spawn = async (command: string, args: readonly string[]) => {
    calls.push({ command, args })
    onSpawn?.()
    if (typeof result === "function") return result()
    return result
  }
  return { calls, spawn }
}

describe("runNativeInstall", () => {
  test("#given bun on PATH #when the native edition is installed #then it runs bun add -g omo-ai@beta", async () => {
    // given
    const { calls, spawn } = recordingSpawn({ exitCode: 0 })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => true,
      spawn,
      environment: emptyEnvironment(),
      probeVersion: probeMissing,
    })

    // then
    expect(calls).toEqual([{ command: "bun", args: ["add", "-g", "omo-ai@beta"] }])
    expect(outcome.ok).toBe(true)
    expect(outcome.notes).toEqual([])
  })

  test("#given bun missing #when the native edition is installed #then it falls back to npm and states bun is recommended", async () => {
    // given
    const { calls, spawn } = recordingSpawn({ exitCode: 0 })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => false,
      spawn,
      environment: emptyEnvironment(),
      probeVersion: probeMissing,
    })

    // then
    expect(calls).toEqual([{ command: "npm", args: ["i", "-g", "omo-ai@beta"] }])
    expect(outcome.ok).toBe(true)
    expect(outcome.notes).toEqual([NATIVE_RECOMMENDED_RUNTIME_NOTE])
  })

  test("#given a non-zero exit #when the native edition is installed #then it reports the reason and the exact manual command", async () => {
    // given
    const { spawn } = recordingSpawn({ exitCode: 7, stderr: "EACCES: permission denied" })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => true,
      spawn,
      environment: emptyEnvironment(),
      probeVersion: probeMissing,
    })

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.failure?.manualCommand).toBe("bun add -g omo-ai@beta")
    expect(outcome.failure?.reason).toContain("exited with code 7")
    expect(outcome.failure?.reason).toContain("EACCES: permission denied")
  })

  test("#given the package manager cannot be spawned #when the native edition is installed #then the error is reported, not thrown", async () => {
    // given
    const { spawn } = recordingSpawn(() => {
      throw new Error("spawn npm ENOENT")
    })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => false,
      spawn,
      environment: emptyEnvironment(),
      probeVersion: probeMissing,
    })

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.failure?.reason).toBe("spawn npm ENOENT")
    expect(outcome.failure?.manualCommand).toBe("npm i -g omo-ai@beta")
  })
})

describe("runNativeInstall legacy omo bin", () => {
  test("#given a legacy global omo #when the native edition is installed #then the stale shim is gone before the package manager runs", async () => {
    // given
    const legacy = writeGlobalPackageBin({
      root: root("wire-legacy"),
      packageName: "oh-my-openagent",
      version: "4.19.4",
      bins: ["omo", "oh-my-openagent"],
    })
    const native = writeGlobalPackageBin({
      root: root("wire-native-target"),
      packageName: "omo-ai",
      version: "5.0.0-0.beta.89",
    })
    rmSync(native.binPath)
    let legacyBinAtSpawnTime = true
    const { spawn } = recordingSpawn({ exitCode: 0 }, () => {
      legacyBinAtSpawnTime = existsSync(legacy.binPath)
      writeGlobalPackageBin({ root: native.root, packageName: "omo-ai", version: "5.0.0-0.beta.89" })
    })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => true,
      spawn,
      environment: environmentOf([legacy.binDir, native.binDir]),
      probeVersion: async () => ({ exitCode: 0, stdout: "omo 5.0.0-0.beta.89 (engine: senpi 0.9.1)\n" }),
    })

    // then
    expect(legacyBinAtSpawnTime).toBe(false)
    expect(existsSync(legacy.binPath)).toBe(false)
    expect(existsSync(`${legacy.binDir}/oh-my-openagent`)).toBe(true)
    expect(outcome.notes.join("\n")).toContain("oh-my-openagent@4.19.4")
    expect(outcome.ok).toBe(true)
    expect(outcome.verified).toBe(true)
    expect(outcome.omoBinPath).toBe(native.binPath)
    expect(outcome.warnings).toEqual([])
  })

  test("#given a legacy npm omo and no bun #when the native edition is installed #then the note says a later npm uninstall takes omo with it and how to restore it", async () => {
    // given omo-ai lands in the same npm bin dir the legacy package's omo was removed from
    const legacy = writeGlobalPackageBin({ root: root("wire-npm-trap"), packageName: "oh-my-openagent", version: "4.19.4" })
    const { spawn } = recordingSpawn({ exitCode: 0 }, () => {
      writeGlobalPackageBin({ root: legacy.root, packageName: "omo-ai", version: "5.0.0-0.beta.89" })
    })
    const dependencies = {
      spawn,
      environment: environmentOf([legacy.binDir]),
      probeVersion: async () => ({ exitCode: 0, stdout: "omo 5.0.0-0.beta.89\n" }),
    }

    // when
    const npmOutcome = await runNativeInstall({ ...dependencies, isBunAvailable: () => false })

    // then
    const trapNotes = npmOutcome.notes.filter((note) => note.includes("npm uninstall -g oh-my-openagent"))
    expect(trapNotes).toHaveLength(1)
    expect(trapNotes[0]).toContain("npm i -g omo-ai@beta")
    expect(npmOutcome.verified).toBe(true)
  })

  test("#given a legacy omo and bun #when the native edition is installed #then no npm uninstall note is printed", async () => {
    // given
    const legacy = writeGlobalPackageBin({ root: root("wire-bun-no-trap"), packageName: "oh-my-openagent", version: "4.19.4" })
    const { spawn } = recordingSpawn({ exitCode: 0 })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => true,
      spawn,
      environment: environmentOf([legacy.binDir]),
      probeVersion: probeMissing,
    })

    // then
    expect(outcome.notes.some((note) => note.includes("npm uninstall -g"))).toBe(false)
  })

  test("#given an unrelated omo keeps resolving first #when the native edition is installed #then the install still succeeds and the PATH fix is reported", async () => {
    // given
    const foreign = writeGlobalPackageBin({ root: root("wire-foreign"), packageName: "omo-tools", version: "1.2.3" })
    const nativeRoot = root("wire-native")
    const { spawn } = recordingSpawn({ exitCode: 0 }, () => {
      writeGlobalPackageBin({ root: nativeRoot, packageName: "omo-ai", version: "5.0.0-0.beta.89" })
    })

    // when
    const outcome = await runNativeInstall({
      isBunAvailable: () => true,
      spawn,
      environment: environmentOf([foreign.binDir, `${nativeRoot}/bin`]),
      probeVersion: async () => ({ exitCode: 0, stdout: "omo-tools 1.2.3\n" }),
    })

    // then
    expect(existsSync(foreign.binPath)).toBe(true)
    expect(outcome.ok).toBe(true)
    expect(outcome.verified).toBe(false)
    expect(outcome.omoBinPath).toBeUndefined()
    expect(outcome.warnings.join("\n")).toContain(`export PATH="${nativeRoot}/bin:$PATH"`)
  })
})

describe("native install messages", () => {
  test("#given a successful npm install #when the outcome is rendered #then it carries the bun note and points at omo setup", async () => {
    // given
    const { spawn } = recordingSpawn({ exitCode: 0 })
    const outcome = await runNativeInstall({
      isBunAvailable: () => false,
      spawn,
      environment: emptyEnvironment(),
      probeVersion: probeMissing,
    })

    // when
    const rendered = [...outcome.notes, nativeInstallSuccessLine(outcome.verified)]

    // then
    expect(rendered[0]).toBe(NATIVE_RECOMMENDED_RUNTIME_NOTE)
    expect(rendered.join("\n")).toContain(NATIVE_SETUP_COMMAND)
    expect(rendered.join("\n")).toContain("OmO Native installed")
  })

  test("#given a failure #when the lines are formatted #then the manual command and the reason are both printable", () => {
    // given
    const failure = { reason: "npm exited with code 1", manualCommand: "npm i -g omo-ai@beta" }

    // when
    const lines = nativeInstallFailureLines(failure)

    // then
    expect(lines.join("\n")).toContain("npm i -g omo-ai@beta")
    expect(lines.join("\n")).toContain("npm exited with code 1")
    expect(lines.join("\n")).toContain(NATIVE_SETUP_COMMAND)
  })

  test("#given the legacy shim could not be removed #when the install fails #then the failure lines carry the manual cleanup", () => {
    // given
    const failure = {
      reason: "npm exited with code 1: EEXIST: file already exists",
      manualCommand: "npm i -g omo-ai@beta",
      hints: ['Remove the stale omo command first: rm "/usr/local/bin/omo"'],
    }

    // when
    const lines = nativeInstallFailureLines(failure)

    // then
    expect(lines.join("\n")).toContain('rm "/usr/local/bin/omo"')
  })
})
