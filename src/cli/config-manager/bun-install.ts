import { existsSync } from "node:fs"
import { getOpenCodeCacheDir } from "../../shared/data-path"
import { log } from "../../shared/logger"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"

const BUN_INSTALL_TIMEOUT_SECONDS = 60
const BUN_INSTALL_TIMEOUT_MS = BUN_INSTALL_TIMEOUT_SECONDS * 1000

export interface BunInstallResult {
  success: boolean
  timedOut?: boolean
  error?: string
}

export async function runBunInstall(): Promise<boolean> {
  const result = await runBunInstallWithDetails()
  return result.success
}

export async function runBunInstallWithDetails(): Promise<BunInstallResult> {
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
      stdout: "inherit",
      stderr: "inherit",
    })

    let timeoutId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), BUN_INSTALL_TIMEOUT_MS)
    })
    const exitPromise = proc.exited.then(() => "completed" as const)
    const result = await Promise.race([exitPromise, timeoutPromise])
    clearTimeout(timeoutId!)

    if (result === "timeout") {
      try {
        proc.kill()
      } catch (err) {
        log("[cli/install] Failed to kill timed out bun install process:", err)
      }
      return {
        success: false,
        timedOut: true,
        error: `bun install timed out after ${BUN_INSTALL_TIMEOUT_SECONDS} seconds. Try running manually: cd "${cacheDir}" && bun i`,
      }
    }

    if (proc.exitCode !== 0) {
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
