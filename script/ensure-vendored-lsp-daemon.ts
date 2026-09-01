import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  realpathSync,
  watch,
  type FSWatcher,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  isProcessAlive,
  readLockPid,
  tryAcquireLock,
} from "../packages/lsp-daemon/src/lock"

export type RunVendoredLspCommand = (
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
  },
) => Promise<number | VendoredLspCommandResult>

export interface VendoredLspCommandResult {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

export type WatchBuildLockDirectory = (
  path: string,
  listener: (event: string, filename: string | Buffer | null) => void,
) => FSWatcher

export interface EnsureVendoredLspDaemonOptions {
  packageDir: string
  outputPath?: string
  timeoutMs?: number
  exists?: (path: string) => boolean
  runCommand?: RunVendoredLspCommand
  log?: (message: string) => void
  lockRoot?: string
  watchDirectory?: WatchBuildLockDirectory
}

const DEFAULT_TIMEOUT_MS = 300_000
const LOCK_RECHECK_INTERVAL_MS = 50
const LOCK_FILE_PREFIX = "omo-test-lsp-build-"

const defaultRunCommand: RunVendoredLspCommand = async (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: options.timeoutMs,
    shell: process.platform === "win32",
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
  }
}

const defaultWatchDirectory: WatchBuildLockDirectory = (path, listener) =>
  watch(path, { persistent: false }, listener)

export async function ensureVendoredLspDaemonBuilt(
  options: EnsureVendoredLspDaemonOptions,
): Promise<void> {
  const outputPath = options.outputPath ?? join(options.packageDir, "dist", "cli.js")
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pathExists = options.exists ?? existsSync
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? console.error
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const deadline = Date.now() + timeoutMs

  if (pathExists(outputPath)) {
    return
  }

  const lockPath = resolveBuildLockPath(options.packageDir, options.lockRoot ?? tmpdir())

  while (!pathExists(outputPath)) {
    const lock = tryAcquireLock(lockPath)
    if (!lock) {
      await waitForBuildTurn(
        lockPath,
        outputPath,
        deadline,
        pathExists,
        watchDirectory,
      )
      continue
    }

    try {
      if (pathExists(outputPath)) {
        return
      }

      log(
        "[test-setup] vendored lsp-daemon dist missing; building once via `npm ci && npm run build`...",
      )

      const installResult = await runCommand("npm", ["ci"], {
        cwd: options.packageDir,
        timeoutMs: remainingMs(deadline, "npm ci"),
      })
      assertCommandSucceeded(installResult, "npm ci")

      const buildResult = await runCommand("npm", ["run", "build"], {
        cwd: options.packageDir,
        timeoutMs: remainingMs(deadline, "npm run build"),
      })
      assertCommandSucceeded(buildResult, "build")
      if (!pathExists(outputPath)) {
        throw new Error(
          `[test-setup] lsp-daemon build completed without ${outputPath}`,
        )
      }
      return
    } finally {
      lock.release()
    }
  }
}

function resolveBuildLockPath(packageDir: string, lockRoot: string): string {
  const packagePath = realpathSync.native(packageDir)
  const digest = createHash("sha256").update(packagePath).digest("hex").slice(0, 20)
  return join(lockRoot, `${LOCK_FILE_PREFIX}${digest}.lock`)
}

async function waitForBuildTurn(
  lockPath: string,
  outputPath: string,
  deadline: number,
  pathExists: (path: string) => boolean,
  watchDirectory: WatchBuildLockDirectory,
): Promise<void> {
  if (buildTurnChanged(lockPath, outputPath, pathExists)) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    let watcher: FSWatcher | undefined
    let settled = false
    const waitMs = remainingMs(deadline, `waiting for ${basename(outputPath)}`)

    const settle = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      clearInterval(stateRecheck)
      watcher?.close()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const checkState = () => {
      if (buildTurnChanged(lockPath, outputPath, pathExists)) {
        settle()
      }
    }

    const timeout = setTimeout(() => {
      settle(new Error(`[test-setup] timed out waiting for ${basename(outputPath)}`))
    }, waitMs)
    const stateRecheck = setInterval(checkState, LOCK_RECHECK_INTERVAL_MS)

    try {
      watcher = watchDirectory(dirname(lockPath), (_event, filename) => {
        if (filename === null || filename.toString() === basename(lockPath)) {
          checkState()
        }
      })
      watcher.on("error", () => {
        watcher?.close()
        watcher = undefined
      })
    } catch {
      watcher = undefined
    }

    checkState()
  })
}

function buildTurnChanged(
  lockPath: string,
  outputPath: string,
  pathExists: (path: string) => boolean,
): boolean {
  if (pathExists(outputPath) || !pathExists(lockPath)) {
    return true
  }
  const ownerPid = readLockPid(lockPath)
  return ownerPid === null || !isProcessAlive(ownerPid)
}

function remainingMs(deadline: number, stage: string): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new Error(`[test-setup] timed out during ${stage}`)
  }
  return remaining
}

function assertCommandSucceeded(
  result: number | VendoredLspCommandResult,
  stage: string,
): void {
  if (typeof result === "number") {
    if (result !== 0) {
      throw new Error(
        `[test-setup] lsp-daemon ${stage} failed with exit code ${result}`,
      )
    }
    return
  }
  if (result.error) {
    throw new Error(
      `[test-setup] lsp-daemon ${stage} failed: ${result.error.message}`,
      { cause: result.error },
    )
  }
  if (result.status !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit code ${String(result.status)}`
    throw new Error(`[test-setup] lsp-daemon ${stage} failed with ${detail}`)
  }
}
