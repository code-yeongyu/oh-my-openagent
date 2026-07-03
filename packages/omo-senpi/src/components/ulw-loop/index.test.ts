/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { __testInternals, createUlwLoopComponent } from "./index"

interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
  details?: unknown
}

interface RunnerCall {
  bin: string
  args: readonly string[]
  cwd: string
}

function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

function activeStatus(id = "G001"): string {
  return JSON.stringify({
    ok: true,
    plan: {
      activeGoalId: id,
      goals: [
        {
          id,
          status: "in_progress",
          title: "Ship ulw-loop",
          successCriteria: [{ id: "C001", status: "pending" }],
        },
      ],
    },
  })
}

function changingActiveStatuses(count: number): string[] {
  return Array.from({ length: count }, (_item, index) =>
    JSON.stringify({
      ok: true,
      plan: {
        activeGoalId: "G001",
        updatedAt: `2026-07-03T00:00:0${index}.000Z`,
        goals: [
          {
            id: "G001",
            status: "in_progress",
            title: "Ship ulw-loop",
            successCriteria: [{ id: "C001", status: "pending" }],
          },
        ],
      },
    }),
  )
}

function completeStatus(): string {
  return JSON.stringify({
    ok: true,
    plan: {
      aggregateCompletion: { status: "complete" },
      goals: [{ id: "G001", status: "complete", successCriteria: [{ id: "C001", status: "pass" }] }],
    },
  })
}

function createRunner(outputs: string[]): {
  readonly calls: RunnerCall[]
  readonly run: (bin: string, args: readonly string[], options: { cwd: string }) => Promise<{ code: number; stdout: string }>
} {
  const calls: RunnerCall[] = []
  return {
    calls,
    async run(bin, args, options) {
      calls.push({ bin, args, cwd: options.cwd })
      return { code: 0, stdout: outputs.shift() ?? activeStatus() }
    },
  }
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {}
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key]
    const value = patch[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function withEnvAsync<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {}
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key]
    const value = patch[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function createTempOmoBin(stdout = activeStatus()): { dir: string; bin: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-ulw-loop-"))
  const bin = join(dir, process.platform === "win32" ? "omo.cmd" : "omo")
  const script =
    process.platform === "win32"
      ? `@echo off\r\ncd > "${join(dir, "cwd.txt")}"\r\necho ${stdout.replace(/"/g, '\\"')}\r\n`
      : `#!/bin/sh\npwd > '${join(dir, "cwd.txt")}'\nprintf '%s\\n' '${stdout.replace(/'/g, "'\\''")}'\n`
  writeFileSync(bin, script)
  chmodSync(bin, 0o755)
  return {
    dir,
    bin,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

async function registerWithRunner(outputs: string[], logger = createLogger()): Promise<{
  readonly pi: FakeExtensionAPI
  readonly logger: ComponentLogger & { entries: RecordedLog[] }
  readonly calls: RunnerCall[]
}> {
  const pi = new FakeExtensionAPI()
  const runner = createRunner(outputs)
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    runCommand: runner.run,
  }).register(pi, { logger, config: { getFlag: () => false } })
  return { pi, logger, calls: runner.calls }
}

describe("omo-senpi ulw-loop component", () => {
  it("#given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored", () => {
    withEnv({ OMO_BIN: "/custom/omo", PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo")
    })
  })

  it("#given omo exists only in a controlled PATH #when resolving the default binary #then it scans PATH without shelling out to Bun", () => {
    const fake = createTempOmoBin()
    try {
      withEnv({ OMO_BIN: undefined, PATH: fake.dir }, () => {
        expect(__testInternals.resolveOmoBin()).toBe(fake.bin)
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given a temp omo binary #when default runOmoCommand executes status #then it captures stdout and cwd via Node-compatible spawning", async () => {
    const fake = createTempOmoBin(activeStatus("NODE-RUNNER"))
    try {
      const result = await __testInternals.runOmoCommand(fake.bin, ["ulw-loop", "status", "--json"], { cwd: fake.dir })

      expect(result).toEqual({ code: 0, stdout: `${activeStatus("NODE-RUNNER")}\n` })
      expect(realpathSync(readFileSync(join(fake.dir, "cwd.txt"), "utf8").trim())).toBe(realpathSync(fake.dir))
    } finally {
      fake.cleanup()
    }
  })

  it("#given env and PATH are controlled #when the component registers with defaults #then no Bun global is required for active status handling", async () => {
    const fake = createTempOmoBin(activeStatus("DEFAULT-REGISTRATION"))
    try {
      await withEnvAsync({ OMO_BIN: undefined, PATH: fake.dir }, async () => {
        const pi = new FakeExtensionAPI()
        await createUlwLoopComponent().register(pi, {
          logger: createLogger(),
          config: { getFlag: () => false },
        })

        const results = await pi.dispatch(
          "input",
          { type: "input", text: "continue", source: "interactive" },
          { cwd: fake.dir },
        )

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ action: "transform" })
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given built Senpi runs under Node #when inspecting runtime source #then the ulw-loop component has no Bun global dependency", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

    expect(source).not.toMatch(/\bBun\b/)
  })

  it("#given no omo binary #when input and agent_end fire #then the component stays inert for the session", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    await createUlwLoopComponent({ resolveOmoBin: () => null }).register(pi, {
      logger,
      config: { getFlag: () => false },
    })
    const inputResults = await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, { cwd: "/repo" })
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(inputResults).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "omo-senpi ulw-loop inactive; omo binary not found",
      },
    ])
  })

  it("#given active incomplete ulw-loop status #when user input arrives #then steering reminder is injected", async () => {
    const { pi, calls } = await registerWithRunner([activeStatus()])

    const results = await pi.dispatch("input", { type: "input", text: "continue", source: "interactive" }, { cwd: "/repo" })

    expect(calls).toEqual([{ bin: "/tmp/omo", args: ["ulw-loop", "status", "--json"], cwd: "/repo" }])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ action: "transform" })
    const transformed = results[0]
    if (!isTransformResult(transformed)) throw new Error("expected transform result")
    expect(transformed.text).toContain("continue")
    expect(transformed.text).toContain("<omo-senpi-ulw-loop>")
    expect(transformed.text).toContain("omo ulw-loop status --json")
  })

  it("#given incomplete goals #when continuation agent_end fires #then sends exactly one followUp user message", async () => {
    const { pi } = await registerWithRunner([activeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(pi.userMessages).toEqual([
      {
        content: expect.stringContaining("Continue the active omo ulw-loop run"),
        options: { deliverAs: "followUp" },
      },
    ])
    expect(pi.messages).toEqual([])
  })

  it("#given incomplete goals #when continuation repeats #then cap stops the 9th consecutive continuation", async () => {
    const { pi, logger } = await registerWithRunner(changingActiveStatuses(9))

    for (let index = 0; index < 9; index += 1) {
      await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    }

    expect(pi.userMessages).toHaveLength(8)
    expect(pi.userMessages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: { reason: "continuation-cap-reached", count: 8 },
    })
  })

  it("#given continuation cap was reached #when user input resets it #then continuation can resume", async () => {
    const { pi } = await registerWithRunner(changingActiveStatuses(10))

    for (let index = 0; index < 8; index += 1) {
      await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    }
    await pi.dispatch("input", { type: "input", text: "still working", source: "interactive" }, { cwd: "/repo" })
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(pi.userMessages).toHaveLength(9)
  })

  it("#given stale status snapshot #when user input arrives #then the next identical active status can continue", async () => {
    const status = activeStatus("G001")
    const { pi, calls } = await registerWithRunner([status, status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    await pi.dispatch("input", { type: "input", text: "resume after user input", source: "interactive" }, { cwd: "/repo" })
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(calls).toHaveLength(3)
    expect(pi.userMessages).toHaveLength(2)
    expect(pi.userMessages.every((call) => call.options?.deliverAs === "followUp")).toBe(true)
  })

  it("#given byte-identical status twice #when continuation repeats #then stale status stops continuation", async () => {
    const status = activeStatus("G001")
    const { pi, logger } = await registerWithRunner([status, status])

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(pi.userMessages).toHaveLength(1)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: { reason: "stale-status" },
    })
  })

  it("#given malformed JSON #when input checks status #then it degrades to no-op with a warning", async () => {
    const { pi, logger } = await registerWithRunner(["{bad json"])

    const results = await pi.dispatch("input", { type: "input", text: "hello", source: "interactive" }, { cwd: "/repo" })

    expect(results).toEqual([{ action: "continue" }])
    expect(pi.userMessages).toEqual([])
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "omo-senpi ulw-loop status ignored",
      details: { reason: "malformed-json" },
    })
  })

  it("#given extension input #when it contains text #then it does not reset or inject", async () => {
    const { pi, calls } = await registerWithRunner(changingActiveStatuses(9))

    for (let index = 0; index < 8; index += 1) {
      await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    }
    await pi.dispatch("input", { type: "input", text: "ulw-loop", source: "extension" }, { cwd: "/repo" })
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(calls).toHaveLength(8)
    expect(pi.userMessages).toHaveLength(8)
  })

  it("#given status reports all complete #when continuation fires #then no followUp is sent", async () => {
    const { pi } = await registerWithRunner([completeStatus()])

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(pi.userMessages).toEqual([])
  })
})

function isTransformResult(value: unknown): value is { action: "transform"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "action") === "transform" &&
    typeof Reflect.get(value, "text") === "string"
  )
}
