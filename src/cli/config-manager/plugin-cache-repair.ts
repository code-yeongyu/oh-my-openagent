import { mkdirSync, rmSync, writeFileSync } from "node:fs"

import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import {
  inspectPluginCache,
  type PluginCacheInspection,
} from "./plugin-cache-health"

const CACHE_WORKSPACE_NAME = "opencode-plugin-cache"

type RepairTool = "npm" | "bun"

export interface PluginCacheRepairAttempt {
  tool: RepairTool
  command: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
  verified: boolean
}

export interface PluginCacheRepairResult {
  success: boolean
  status: "skipped" | "healthy" | "repaired" | "failed"
  attempted: boolean
  initialInspection: PluginCacheInspection
  finalInspection: PluginCacheInspection
  attempts: PluginCacheRepairAttempt[]
  error?: string
}

function createWorkspacePackageJson(): string {
  return JSON.stringify(
    {
      name: CACHE_WORKSPACE_NAME,
      private: true,
    },
    null,
    2,
  ) + "\n"
}

function prepareWorkspace(cacheDir: string, packageJsonPath: string): void {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(packageJsonPath, createWorkspacePackageJson(), "utf-8")
}

async function readStream(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (!stream) {
    return ""
  }

  return new Response(stream).text()
}

async function runInstallAttempt(
  tool: RepairTool,
  entry: string,
  workspaceDir: string,
): Promise<Omit<PluginCacheRepairAttempt, "verified">> {
  const command = tool === "npm" ? ["npm", "install", entry] : ["bun", "add", entry]

  try {
    const proc = spawnWithWindowsHide(command, {
      cwd: workspaceDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdoutPromise = readStream(proc.stdout)
    const stderrPromise = readStream(proc.stderr)

    await proc.exited

    return {
      tool,
      command,
      exitCode: proc.exitCode,
      stdout: await stdoutPromise,
      stderr: await stderrPromise,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      tool,
      command,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: message,
    }
  }
}

function createFailureResult(
  initialInspection: PluginCacheInspection,
  finalInspection: PluginCacheInspection,
  attempts: PluginCacheRepairAttempt[],
  error: string,
): PluginCacheRepairResult {
  return {
    success: false,
    status: "failed",
    attempted: attempts.length > 0,
    initialInspection,
    finalInspection,
    attempts,
    error,
  }
}

export async function repairPluginCache(entry: string): Promise<PluginCacheRepairResult> {
  const initialInspection = inspectPluginCache(entry)
  if (initialInspection.status === "local") {
    return {
      success: true,
      status: "skipped",
      attempted: false,
      initialInspection,
      finalInspection: initialInspection,
      attempts: [],
    }
  }

  if (initialInspection.status === "healthy") {
    return {
      success: true,
      status: "healthy",
      attempted: false,
      initialInspection,
      finalInspection: initialInspection,
      attempts: [],
    }
  }

  const location = initialInspection.location
  if (!location.cacheDir || !location.cachePackagePath) {
    return createFailureResult(
      initialInspection,
      initialInspection,
      [],
      "Plugin cache location could not be resolved.",
    )
  }

  if (initialInspection.status === "corrupt" && location.cacheDir) {
    rmSync(location.cacheDir, { recursive: true, force: true })
  }

  const attempts: PluginCacheRepairAttempt[] = []
  const tools: RepairTool[] = ["npm", "bun"]

  for (const tool of tools) {
    rmSync(location.cacheDir, { recursive: true, force: true })
    prepareWorkspace(location.cacheDir, location.cachePackagePath)

    const attempt = await runInstallAttempt(tool, entry, location.cacheDir)
    const inspection = inspectPluginCache(entry)
    attempts.push({
      ...attempt,
      verified: inspection.status === "healthy",
    })

    if (inspection.status === "healthy") {
      return {
        success: true,
        status: "repaired",
        attempted: true,
        initialInspection,
        finalInspection: inspection,
        attempts,
      }
    }
  }

  const finalInspection = inspectPluginCache(entry)
  const lastAttempt = attempts.at(-1)
  const lastError = lastAttempt?.error
  const missingSummary = finalInspection.missingPaths.length > 0
    ? `Missing: ${finalInspection.missingPaths.join(", ")}.`
    : "Cache verification failed after reinstall."

  return createFailureResult(
    initialInspection,
    finalInspection,
    attempts,
    lastError ? `Cache repair failed: ${lastError}` : missingSummary,
  )
}
