import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { rmEfaultTolerant } from "../teardown.test-support"
import { createMemoryRunSupervisorIc8ExitResources } from "./memory-run-supervisor-ic8-exit-resources"
import {
  processGroupIsAlive,
  terminateProcessGroup,
  validateProcessGroupPid,
} from "./memory-run-supervisor-ic8-process-groups"
import {
  advanceTestClock,
  createTestClock,
  waitForFilesystemState,
} from "./supervisor-test-signals"

export const IC8_WAIT_MS = 60_000
export const IC8_PLATFORMS = ["posix", "win32"] as const

export function createMemoryRunSupervisorIc8Harness() {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url))
  const supervisorPath = join(moduleDir, "memory-run-supervisor.ts")
  const childFixture = join(moduleDir, "__fixtures__", "supervisor-child.ts")
  const taskkillFixture = join(moduleDir, "__fixtures__", "supervisor-taskkill.ts")
  const roots: string[] = []
  const cleanedRunRoots = new Set<string>()
  const liveProcesses = new Set<number>()
  const exitResources = createMemoryRunSupervisorIc8ExitResources(IC8_WAIT_MS)

  const waitForPath = async (path: string, timeoutMs = IC8_WAIT_MS) => {
    await waitForFilesystemState(
      dirname(path),
      () => (existsSync(path) ? true : undefined),
      timeoutMs,
      path,
    )
  }

  const makeRun = async (mode: "graceful" | "stubborn") => {
    const runDir = realpathSync.native(
      await mkdtemp(join(tmpdir(), "memory-run-supervisor-ic8-")),
    )
    roots.push(runDir)
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    const clockPath = await createTestClock(runDir, 1_000)
    const { port, childExited, exitSocketAccepted } =
      await exitResources.openServer()
    await writeFile(
      join(runDir, "ledger.json"),
      `${JSON.stringify({ version: 1, runId: "run-ic8", kind: "reflection" })}\n`,
    )
    await writeFile(
      join(runDir, "launch.json"),
      `${JSON.stringify({
        version: 1,
        runId: "run-ic8",
        kind: "reflection",
        command: process.execPath,
        args: [childFixture, mode, runDir],
        cwd: runDir,
        env: {
          ...process.env,
          OMO_MEMORY_SUPERVISOR_EXIT_PORT: String(port),
        },
        hardDeadlineAt: 2_000,
        terminationGraceMs: 1_000,
        maxOutputBytes: 65_536,
        stdoutPath: join(runDir, "child-stdout.log"),
        stderrPath: join(runDir, "child-stderr.log"),
      })}\n`,
      { mode: 0o600 },
    )
    return { runDir, clockPath, childExited, exitSocketAccepted }
  }

  const launchSupervisor = (
    runDir: string,
    clockPath: string,
    platform: (typeof IC8_PLATFORMS)[number],
  ): ChildProcess => {
    const child = spawn(process.execPath, [supervisorPath, runDir], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
        OMO_MEMORY_SUPERVISOR_PLATFORM: platform,
        OMO_MEMORY_SUPERVISOR_CLOCK_PATH: clockPath,
        OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND: JSON.stringify([
          process.execPath,
          taskkillFixture,
        ]),
        OMO_MEMORY_SUPERVISOR_TASKKILL_RUN_DIR: runDir,
        ...(process.platform === "win32" && platform === "posix"
          ? {
              OMO_MEMORY_SUPERVISOR_POSIX_SIGNAL_COMMAND: JSON.stringify([
                process.execPath,
                taskkillFixture,
              ]),
            }
          : {}),
      },
    })
    if (child.pid !== undefined) liveProcesses.add(child.pid)
    return child
  }

  const waitForExit = (
    child: ChildProcess,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        exitResources.clearTrackedTimeout(timeout)
        child.off("error", onError)
        child.off("close", onClose)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup()
        if (child.pid !== undefined) liveProcesses.delete(child.pid)
        resolve({ code, signal })
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`waited ${IC8_WAIT_MS}ms for process exit`))
      }, IC8_WAIT_MS)
      exitResources.trackTimeout(timeout)
      child.once("error", onError)
      child.once("close", onClose)
    })

  const ledgerChildProcessGroups = async () => {
    const groups = new Set<number>()
    for (const runDir of roots) {
      if (cleanedRunRoots.has(runDir)) continue
      const ledger = JSON.parse(
        await readFile(join(runDir, "ledger.json"), "utf8"),
      ) as { readonly childPid?: number }
      if (ledger.childPid !== undefined) {
        groups.add(validateProcessGroupPid(ledger.childPid))
      }
    }
    return groups
  }
  const cleanupRunResources = async () => {
    let cleanupError: Error | undefined
    const groups = new Set(liveProcesses)
    let ledgerGroups = new Set<number>()
    try {
      ledgerGroups = await ledgerChildProcessGroups()
    } catch (error) {
      cleanupError = asError(error)
    }
    if (exitResources.hasConnectedSockets()) {
      for (const pid of ledgerGroups) groups.add(pid)
    }
    for (const pid of groups) {
      if (!processGroupIsAlive(pid)) continue
      try {
        terminateProcessGroup(pid)
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
          cleanupError ??= asError(error)
        }
      }
    }
    liveProcesses.clear()
    try {
      const { forcedSocketDestructions } = await exitResources.cleanup()
      if (forcedSocketDestructions > 0) {
        cleanupError ??= new Error(
          `forced ${forcedSocketDestructions} model socket cleanup(s)`,
        )
      }
    } catch (error) {
      cleanupError ??= asError(error)
    }
    for (const pid of groups) {
      try {
        await waitForProcessGroupExit(pid)
      } catch (error) {
        cleanupError ??= asError(error)
      }
    }
    for (const runDir of roots) cleanedRunRoots.add(runDir)
    if (cleanupError !== undefined) throw cleanupError
  }

  const waitForProcessGroupExit = async (pid: number) => {
    if (!processGroupIsAlive(pid)) return
    let interval: ReturnType<typeof setInterval> | undefined
    try {
      await exitResources.waitBounded(
        new Promise<void>((resolve) => {
          interval = setInterval(() => {
            if (processGroupIsAlive(pid)) return
            clearInterval(interval)
            interval = undefined
            resolve()
          }, 25)
        }),
        5_000,
        `process group ${pid} exit`,
      )
    } finally {
      if (interval !== undefined) clearInterval(interval)
    }
  }
  const cleanup = async () => {
    let cleanupError: Error | undefined
    try {
      await cleanupRunResources()
    } catch (error) {
      cleanupError = asError(error)
    }
    const removals = await Promise.allSettled(
      roots
        .splice(0)
        .map((root) =>
          rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }),
        ),
    )
    for (const result of removals) {
      if (result.status === "rejected") cleanupError ??= asError(result.reason)
    }
    cleanedRunRoots.clear()
    if (cleanupError !== undefined) throw cleanupError
  }

  return {
    advanceClock: advanceTestClock,
    cleanup,
    cleanupExitResources: exitResources.cleanup,
    cleanupRunResources,
    launchSupervisor,
    makeRun,
    processGroupIsAlive,
    resourceCounts: exitResources.counts,
    trackProcessGroup: (pid: number) => liveProcesses.add(pid),
    untrackProcessGroup: (pid: number) => liveProcesses.delete(pid),
    waitForExit,
    waitForPath,
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
