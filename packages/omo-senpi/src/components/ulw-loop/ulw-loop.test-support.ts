import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createUlwLoopComponent } from "./index"

export interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
  details?: unknown
}

interface RunnerCall {
  bin: string
  args: readonly string[]
  cwd: string
}

export function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
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

export const TEST_SESSION_ID = "test-session"

// The status probe is session-scoped and fails closed without a session identity, so every event context
// that expects the toolkit to be consulted must carry the host session id the real Senpi host provides.
export function sessionEventCtx(cwd: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { cwd, sessionManager: { getSessionId: () => TEST_SESSION_ID }, ...extra }
}

export function statusArgsFor(sessionId = TEST_SESSION_ID): string[] {
  return ["ulw-loop", "status", "--json", "--session-id", sessionId]
}

export function activeStatus(id = "G001"): string {
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

export function changingActiveStatuses(count: number): string[] {
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

export function completeStatus(): string {
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

export function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
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

export async function withEnvAsync<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  // Keep process-global mutations scoped to synchronous invocation. Holding them
  // across await points races other Bun test files that share this process.
  return withEnv(patch, run)
}

export function createTempOmoBin(stdout = activeStatus(), name = "omo"): { dir: string; bin: string; cleanup: () => void } {
  const nodeExecutable = resolveNodeExecutable()
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-ulw-loop-"))
  // The default plan lookup gates the spawn on the session-scoped goals.json.
  mkdirSync(join(dir, ".omo", "ulw-loop", TEST_SESSION_ID), { recursive: true })
  writeFileSync(join(dir, ".omo", "ulw-loop", TEST_SESSION_ID, "goals.json"), "{}\n")
  const bin = join(dir, process.platform === "win32" ? `${name}.cmd` : name)
  const runner = join(dir, `${name}-runner.cjs`)
  writeFileSync(
    runner,
    [
      "const { realpathSync, writeFileSync } = require('node:fs')",
      `writeFileSync(${JSON.stringify(join(dir, "cwd.txt"))}, realpathSync(process.cwd()))`,
      `writeFileSync(${JSON.stringify(join(dir, "runtime.json"))}, JSON.stringify({ bunVersion: process.versions.bun ?? null }))`,
      `writeFileSync(${JSON.stringify(join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)))`,
      `process.stdout.write(${JSON.stringify(`${stdout}\n`)})`,
      "",
    ].join("\n"),
  )
  const script =
    process.platform === "win32"
      ? `@echo off\r\n"${nodeExecutable}" "${runner}" %*\r\n`
      : `#!/bin/sh\n'${nodeExecutable.replace(/'/g, "'\\''")}' '${runner.replace(/'/g, "'\\''")}' "$@"\n`
  writeFileSync(bin, script)
  chmodSync(bin, 0o755)
  return {
    dir,
    bin,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function readRealCwd(dir: string): string {
  return realpathSync(readFileSync(join(dir, "cwd.txt"), "utf8").trim())
}

export function readRunnerArgv(dir: string): string[] {
  return JSON.parse(readFileSync(join(dir, "argv.json"), "utf8")) as string[]
}

export function createTempStderrFloodScript(
  byteCount: number,
  stdout = activeStatus(),
): { dir: string; script: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-ulw-loop-flood-"))
  // The default plan lookup gates the spawn, so a fixture that expects the toolkit to run needs a ledger dir.
  mkdirSync(join(dir, ".omo", "ulw-loop"), { recursive: true })
  const script = join(dir, "flood.js")
  writeFileSync(
    script,
    [
      `const total = ${byteCount}`,
      'const chunk = Buffer.alloc(64 * 1024, "x")',
      "let remaining = total",
      "while (remaining > 0) {",
      "  const slice = chunk.subarray(0, Math.min(chunk.length, remaining))",
      "  process.stderr.write(slice)",
      "  remaining -= slice.length",
      "}",
      `process.stdout.write(${JSON.stringify(`${stdout}\n`)})`,
      "",
    ].join("\n"),
  )
  return { dir, script, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function readRunnerRuntime(dir: string): { bunVersion: string | null } {
  return JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8")) as {
    bunVersion: string | null
  }
}

let cachedNodeExecutable: string | undefined

function resolveNodeExecutable(): string {
  if (cachedNodeExecutable !== undefined) return cachedNodeExecutable
  const executable = execFileSync("node", ["-p", "process.execPath"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  }).trim()
  if (executable.length === 0) throw new Error("node did not report process.execPath")
  cachedNodeExecutable = executable
  return executable
}

export async function registerWithRunner(outputs: string[], logger = createLogger()): Promise<{
  readonly pi: FakeExtensionAPI
  readonly logger: ComponentLogger & { entries: RecordedLog[] }
  readonly calls: RunnerCall[]
}> {
  const pi = new FakeExtensionAPI()
  const runner = createRunner(outputs)
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    runCommand: runner.run,
    // Fixture cwds are synthetic paths; the real `.omo/ulw-loop` lookup is covered by its own suite.
    planExists: () => true,
  }).register(pi, { logger, config: { getFlag: () => false } })
  return { pi, logger, calls: runner.calls }
}

export function isTransformResult(value: unknown): value is { action: "transform"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "action") === "transform" &&
    typeof Reflect.get(value, "text") === "string"
  )
}
