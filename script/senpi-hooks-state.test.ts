import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_DIR_NAME } from "../node_modules/@code-yeongyu/senpi/dist/config.js"
import { FileHookStateStorage } from "../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"

type WriterCleanupPhase = "terminate" | "verify-exit"

interface WriterCleanupReport {
  readonly phase: WriterCleanupPhase
  readonly pid: number
}

interface WriterTermination {
  readonly platform: NodeJS.Platform
  readonly run: (command: string, args: readonly string[]) => {
    readonly error?: Error
    readonly status: number | null
    readonly stderr?: string | null
  }
  readonly signal: (pid: number, signal: NodeJS.Signals) => void
}

interface WriterExitVerification {
  readonly isAlive: (pid: number) => boolean
  readonly pause: (ms: number) => Promise<void>
  readonly pollAttempts: number
}

class TimedOutWriterCleanupError extends Error {
  constructor(
    readonly phase: WriterCleanupPhase,
    readonly pid: number,
    reason: string,
  ) {
    super(`Hooks-state writer cleanup failed during ${phase} for pid ${pid}: ${reason}`)
  }
}

const defaultWriterTermination: WriterTermination = {
  platform: process.platform,
  run: (command, args) => spawnSync(command, [...args], { encoding: "utf8" }),
  signal: process.kill.bind(process),
}

const defaultWriterExitVerification: WriterExitVerification = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const code = "code" in error ? error.code : undefined
      if (code === "ESRCH") return false
      if (code === "EPERM") return true
      throw error
    }
  },
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollAttempts: 20,
}

async function terminateTimedOutWriter(
  pid: number,
  termination: WriterTermination = defaultWriterTermination,
  verification: WriterExitVerification = defaultWriterExitVerification,
): Promise<WriterCleanupReport> {
  if (termination.platform === "win32") {
    const result = termination.run("taskkill.exe", ["/PID", String(pid), "/T", "/F"])
    if (result.error !== undefined || result.status !== 0) {
      const reason = result.error?.message
        ?? result.stderr?.trim()
        ?? `taskkill exited with status ${result.status}`
      throw new TimedOutWriterCleanupError("terminate", pid, reason)
    }
  } else {
    try {
      termination.signal(-pid, "SIGTERM")
    } catch (error) {
      throw new TimedOutWriterCleanupError("terminate", pid, error instanceof Error ? error.message : String(error))
    }
  }

  for (let attempt = 0; attempt < verification.pollAttempts; attempt += 1) {
    if (!verification.isAlive(pid)) return { phase: "verify-exit", pid }
    if (attempt + 1 < verification.pollAttempts) await verification.pause(10)
  }
  throw new TimedOutWriterCleanupError("verify-exit", pid, "writer remained alive after termination")
}

function withStorage(run: (fixture: {
  root: string
  statePath: string
  storage: FileHookStateStorage
}) => void): void {
  const root = mkdtempSync(join(tmpdir(), "omo-hooks-state-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const statePath = join(cwd, CONFIG_DIR_NAME, "hooks-state.json")
  mkdirSync(dirname(statePath), { recursive: true })
  try {
    run({ root, statePath, storage: new FileHookStateStorage({ cwd, agentDir }) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function temporarySnapshots(statePath: string): string[] {
  const prefix = `${statePath.split(/[\\/]/).at(-1)}.`
  return readdirSync(dirname(statePath)).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
}

describe("timed-out hooks-state writer cleanup", () => {
  test("uses forced taskkill tree termination on win32 and reports the writer", async () => {
    const calls: Array<{ readonly args: readonly string[]; readonly command: string }> = []

    const report = await terminateTimedOutWriter(
      4242,
      {
        platform: "win32",
        run: (command, args) => {
          calls.push({ args, command })
          return { status: 0 }
        },
        signal: () => undefined,
      },
      { isAlive: () => false, pause: () => Promise.resolve(), pollAttempts: 1 },
    )

    expect(calls).toEqual([{
      command: "taskkill.exe",
      args: ["/PID", "4242", "/T", "/F"],
    }])
    expect(report).toEqual({ phase: "verify-exit", pid: 4242 })
  })

  test("signals the POSIX writer process group and reports the writer", async () => {
    const signals: Array<{ readonly pid: number; readonly signal: NodeJS.Signals }> = []

    const report = await terminateTimedOutWriter(
      5151,
      {
        platform: "linux",
        run: () => {
          throw new Error("unexpected command spawn")
        },
        signal: (pid, signal) => signals.push({ pid, signal }),
      },
      { isAlive: () => false, pause: () => Promise.resolve(), pollAttempts: 1 },
    )

    expect(signals).toEqual([{ pid: -5151, signal: "SIGTERM" }])
    expect(report).toEqual({ phase: "verify-exit", pid: 5151 })
  })

  test("reports the verification phase and pid when the writer survives", async () => {
    const cleanup = terminateTimedOutWriter(
      6161,
      {
        platform: "linux",
        run: () => {
          throw new Error("unexpected command spawn")
        },
        signal: () => undefined,
      },
      { isAlive: () => true, pause: () => Promise.resolve(), pollAttempts: 1 },
    )

    await expect(cleanup).rejects.toMatchObject({ phase: "verify-exit", pid: 6161 })
  })
})

describe("patched Senpi hooks state snapshots", () => {
  test("reads the last complete snapshot while the exact writer lock is held", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, '{"version":1,"hooks":{}}\n', "utf8")
      mkdirSync(`${statePath}.lock`)

      expect(storage.read("project")).toEqual({ version: 1, hooks: {} })
    })
  })

  test("recovers a trusted snapshot at a synchronized legacy truncate/write boundary", async () => {
    const runner = join(import.meta.dir, "fixtures", "senpi-hooks-state-legacy-reader.ts")
    const child = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 10_000 })
    if (child.error !== undefined && "code" in child.error && child.error.code === "ETIMEDOUT") {
      const marker = join(tmpdir(), `omo-hooks-legacy-reader-${child.pid}.json`)
      try {
        const { root, writerPid } = JSON.parse(readFileSync(marker, "utf8")) as { root: string; writerPid?: number }
        if (writerPid !== undefined) await terminateTimedOutWriter(writerPid)
        rmSync(root, { recursive: true, force: true })
      } finally {
        rmSync(marker, { force: true })
      }
    }

    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({
      released: true,
      state: {
        version: 1,
        hooks: {
          hk_trusted: {
            enabled: true,
            trustedHash: "sha256:trusted",
            scope: "project",
            sourcePath: "/project/hooks.json",
            commandPreview: "echo trusted",
            updatedAt: "2026-08-31T00:00:00.000Z",
          },
        },
      },
    })
  }, 60_000)

  test("keeps malformed state fail-closed when no writer lock exists", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, "{ malformed", "utf8")

      expect(storage.read("project")).toEqual({ version: 1, hooks: {} })
    })
  })

  test("publishes by replacing the destination and leaves no temporary snapshot", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, '{"version":1,"hooks":{}}\n', "utf8")

      const next = storage.update("project", (current) => current)

      expect(storage.read("project")).toEqual(next)
      expect(temporarySnapshots(statePath)).toEqual([])
    })
  })

  test.skipIf(process.platform === "win32")("preserves an existing POSIX snapshot mode under a restrictive umask", () => {
    const runner = join(import.meta.dir, "fixtures", "senpi-hooks-state-mode-runner.ts")
    const child = spawnSync(process.execPath, [runner], { encoding: "utf8" })

    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ mode: 0o640 })
  }, 60_000)

  test.skipIf(process.platform === "win32")("creates a new POSIX snapshot with mode 0600 under a permissive umask", () => {
    withStorage(({ statePath, storage }) => {
      rmSync(statePath, { force: true })
      const previousUmask = process.umask(0)
      try {
        storage.update("project", (current) => current)
      } finally {
        process.umask(previousUmask)
      }

      expect(statSync(statePath).mode & 0o777).toBe(0o600)
    })
  })
})
