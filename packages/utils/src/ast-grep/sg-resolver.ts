import { execFileSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

import { bunWhich } from "../runtime/which"
import { sgBinaryName } from "./sg-manifest"
import { SG_PATH_ENV_KEY, type SgResolverOptions } from "./types"

function nonEmptyValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed
}

function defaultFileExists(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  try {
    const stats = statSync(filePath)
    return stats.isFile() && stats.size > 0
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function defaultVersionProbe(binaryPath: string): string {
  return String(execFileSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 5_000 }))
}

function isAstGrepVersionOutput(output: string): boolean {
  return output.toLowerCase().includes("ast-grep")
}

function hasAstGrepVersion(binaryPath: string, runVersionProbeSync: (binaryPath: string) => string): boolean {
  try {
    return isAstGrepVersionOutput(runVersionProbeSync(binaryPath))
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function pathCommandCandidates(platform: NodeJS.Platform): readonly string[] {
  return platform === "linux" ? ["ast-grep", "sg"] : ["sg", "ast-grep"]
}

export function findSgBinarySync(options: SgResolverOptions = {}): string | null {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? defaultFileExists
  const runVersionProbeSync = options.runVersionProbeSync ?? defaultVersionProbe
  const which = options.which ?? bunWhich

  try {
    const envOverride = nonEmptyValue(env[SG_PATH_ENV_KEY])
    if (envOverride !== null && fileExists(envOverride)) return envOverride

    if (options.runtimeDir !== undefined) {
      const runtimeCandidate = join(options.runtimeDir, sgBinaryName(platform))
      if (fileExists(runtimeCandidate)) return runtimeCandidate
    }

    for (const commandName of pathCommandCandidates(platform)) {
      const pathCandidate = which(commandName)
      if (pathCandidate === null || !fileExists(pathCandidate)) continue
      if (commandName !== "sg" || hasAstGrepVersion(pathCandidate, runVersionProbeSync)) return pathCandidate
    }
    return null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}
