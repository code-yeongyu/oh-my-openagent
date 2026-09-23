/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  NATIVE_RECOMMENDED_RUNTIME_NOTE,
  NATIVE_SETUP_COMMAND,
  nativeInstallFailureLines,
  nativeInstallSuccessLine,
  runNativeInstall,
} from "./index"
import type { NativeInstallSpawnResult } from "./index"

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
}

function recordingSpawn(result: NativeInstallSpawnResult | (() => never)) {
  const calls: SpawnCall[] = []
  const spawn = async (command: string, args: readonly string[]) => {
    calls.push({ command, args })
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
    const outcome = await runNativeInstall({ isBunAvailable: () => true, spawn })

    // then
    expect(calls).toEqual([{ command: "bun", args: ["add", "-g", "omo-ai@beta"] }])
    expect(outcome.ok).toBe(true)
    expect(outcome.notes).toEqual([])
  })

  test("#given bun missing #when the native edition is installed #then it falls back to npm and states bun is recommended", async () => {
    // given
    const { calls, spawn } = recordingSpawn({ exitCode: 0 })

    // when
    const outcome = await runNativeInstall({ isBunAvailable: () => false, spawn })

    // then
    expect(calls).toEqual([{ command: "npm", args: ["i", "-g", "omo-ai@beta"] }])
    expect(outcome.ok).toBe(true)
    expect(outcome.notes).toEqual([NATIVE_RECOMMENDED_RUNTIME_NOTE])
  })

  test("#given a non-zero exit #when the native edition is installed #then it reports the reason and the exact manual command", async () => {
    // given
    const { spawn } = recordingSpawn({ exitCode: 7, stderr: "EACCES: permission denied" })

    // when
    const outcome = await runNativeInstall({ isBunAvailable: () => true, spawn })

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
    const outcome = await runNativeInstall({ isBunAvailable: () => false, spawn })

    // then
    expect(outcome.ok).toBe(false)
    expect(outcome.failure?.reason).toBe("spawn npm ENOENT")
    expect(outcome.failure?.manualCommand).toBe("npm i -g omo-ai@beta")
  })
})

describe("native install messages", () => {
  test("#given a successful npm install #when the outcome is rendered #then it carries the bun note and points at omo setup", async () => {
    // given
    const { spawn } = recordingSpawn({ exitCode: 0 })
    const outcome = await runNativeInstall({ isBunAvailable: () => false, spawn })

    // when
    const rendered = [...outcome.notes, nativeInstallSuccessLine()]

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
})
