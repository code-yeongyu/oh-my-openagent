import { existsSync } from "node:fs"

import { getOpenCodeCacheDir } from "../../shared/data-path"
import { log } from "../../shared/logger"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"

const BUN_INSTALL_TIMEOUT_SECONDS = 60
const BUN_INSTALL_TIMEOUT_MS = BUN_INSTALL_TIMEOUT_SECONDS * 1000

type BunInstallOutputMode = "inherit" | "pipe"

interface RunBunInstallOptions {
  outputMode?: BunInstallOutputMode
}

interface BunInstallOutput {
  stdout: string
  stderr: string
}

declare function setTimeout(callback: () => void, delay?: number): number
declare function clearTimeout(timeout: number): void

type ProcessOutputStream = ReturnType<typeof spawnWithWindowsHide>["stdout"]

declare const Bun: {
  readableStreamToText(stream: NonNullable<ProcessOutputStream>): Promise<string>
}

export interface BunInstallResult {
  success: boolean
  timedOut?: boolean
  error?: string
}

export async function runBunInstall(): Promise<boolean> {
  const result = await runBunInstallWithDetails()
  return result.success
}

function readProcessOutput(stream: ProcessOutputStream): Promise<string> {
  if (!stream) {
    return Promise.resolve("")
  }

  return Bun.readableStreamToText(stream)
}

function logCapturedOutputOnFailure(outputMode: BunInstallOutputMode, output: BunInstallOutput): void {
  if (outputMode !== "pipe") {
    return
  }

  const stdout = output.stdout.trim()
  const stderr = output.stderr.trim()
  if (!stdout && !stderr) {
    return
  }

  log("[bun-install] Captured output from failed bun install", {
    stdout,
    stderr,
  })
}

export async function runBunInstallWithDetails(options?: RunBunInstallOptions): Promise<BunInstallResult> {
  const outputMode = options?.outputMode ?? "inherit"
  const cacheDir = getOpenCodeCacheDir()
  const packageJsonPath = `${cacheDir}/package.json`

  if (!existsSync(packageJsonPath)) {
    return {
      success: false,
      error: `Workspace not initialized: ${packageJsonPath} not found. OpenCode should create this on first run.`,
    }
  }

  try {
    const proc = spawnWithWindowsHide(["bun", "install"], {
      cwd: cacheDir,
      stdout: outputMode,
      stderr: outputMode,
    })

    const outputPromise = Promise.all([readProcessOutput(proc.stdout), readProcessOutput(proc.stderr)]).then(
      ([stdout, stderr]) => ({ stdout, stderr })
    )

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), BUN_INSTALL_TIMEOUT_MS)
    })
    const exitPromise = proc.exited.then(() => "completed" as const)
    const result = await Promise.race([exitPromise, timeoutPromise])
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (result === "timeout") {
      try {
        proc.kill()
      } catch (err) {
        log("[cli/install] Failed to kill timed out bun install process:", err)
      }

      if (outputMode === "pipe") {
        void outputPromise
          .then((output) => {
            logCapturedOutputOnFailure(outputMode, output)
          })
          .catch((err) => {
            log("[bun-install] Failed to read captured output after timeout:", err)
          })
      }

      return {
        success: false,
        timedOut: true,
        error: `bun install timed out after ${BUN_INSTALL_TIMEOUT_SECONDS} seconds. Try running manually: cd "${cacheDir}" && bun i`,
      }
    }

    const output = await outputPromise

    if (proc.exitCode !== 0) {
      logCapturedOutputOnFailure(outputMode, output)

      return {
        success: false,
        error: `bun install failed with exit code ${proc.exitCode}`,
      }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `bun install failed: ${message}. Is bun installed? Try: curl -fsSL https://bun.sh/install | bash`,
    }
  }
}
