import { spawn } from "bun"
import {
  resolveGrepCli,
  type GrepBackend,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIMIT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OUTPUT_BYTES,
  RG_FILES_FLAGS,
} from "./constants"
import type { GlobOptions, GlobResult, FileMatch } from "./types"
import { stat } from "node:fs/promises"

export interface ResolvedCli {
  path: string
  backend: GrepBackend
}

function buildRgArgs(options: GlobOptions): string[] {
  const args: string[] = [
    ...RG_FILES_FLAGS,
    `--max-depth=${Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)}`,
  ]

  if (options.hidden !== false) args.push("--hidden")
  if (options.follow !== false) args.push("--follow")
  if (options.noIgnore) args.push("--no-ignore")

  args.push(`--glob=${options.pattern}`)

  return args
}

function buildFindArgs(options: GlobOptions): string[] {
  const args: string[] = []

  if (options.follow !== false) {
    args.push("-L")
  }

  args.push(".")

  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)
  args.push("-maxdepth", String(maxDepth))

  args.push("-type", "f")
  args.push("-name", options.pattern)

  if (options.hidden === false) {
    args.push("-not", "-path", "*/.*")
  }

  return args
}

function buildPowerShellCommand(options: GlobOptions): string[] {
  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)
  const paths = options.paths?.length ? options.paths : ["."]
  const searchPath = paths[0] || "."

  const escapedPath = searchPath.replace(/'/g, "''")
  const escapedPattern = options.pattern.replace(/'/g, "''")

  let psCommand = `Get-ChildItem -Path '${escapedPath}' -File -Recurse -Depth ${maxDepth - 1} -Filter '${escapedPattern}'`

  if (options.hidden !== false) {
    psCommand += " -Force"
  }

  // NOTE: Symlink following (-FollowSymlink) is NOT supported in PowerShell backend.
  // -FollowSymlink was introduced in PowerShell Core 6.0+ and is unavailable in
  // Windows PowerShell 5.1 (default on Windows). OpenCode auto-downloads ripgrep
  // which handles symlinks via --follow. This fallback rarely triggers in practice.

  psCommand += " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName"

  return ["powershell", "-NoProfile", "-Command", psCommand]
}

async function getFileMtime(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath)
    return stats.mtime.getTime()
  } catch {
    return 0
  }
}

export { buildRgArgs, buildFindArgs, buildPowerShellCommand }

export async function runRgFiles(
  options: GlobOptions,
  resolvedCli?: ResolvedCli
): Promise<GlobResult> {
  const cli = resolvedCli ?? resolveGrepCli()
  const timeout = Math.min(options.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT)

  const isRg = cli.backend === "rg"
  const isWindows = process.platform === "win32"

  let command: string[]
  let cwd: string | undefined

  if (isRg) {
    const args = buildRgArgs(options)
    const paths = options.paths?.length ? options.paths : ["."]
    args.push(...paths)
    command = [cli.path, ...args]
    cwd = undefined
  } else if (isWindows) {
    command = buildPowerShellCommand(options)
    cwd = undefined
  } else {
    const args = buildFindArgs(options)
    const paths = options.paths?.length ? options.paths : ["."]
    cwd = paths[0] || "."
    command = [cli.path, ...args]
  }

  const proc = spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd,
  })

  const timeoutPromise = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      proc.kill()
      reject(new Error(`Glob search timeout after ${timeout}ms`))
    }, timeout)
    proc.exited.then(() => clearTimeout(id))
  })

  try {
    const stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode > 1 && stderr.trim()) {
      return {
        files: [],
        totalFiles: 0,
        truncated: false,
        error: stderr.trim(),
      }
    }

    const truncatedOutput = stdout.length >= DEFAULT_MAX_OUTPUT_BYTES
    const outputToProcess = truncatedOutput ? stdout.substring(0, DEFAULT_MAX_OUTPUT_BYTES) : stdout

    const lines = outputToProcess.trim().split("\n").filter(Boolean)

    const files: FileMatch[] = []
    let truncated = false

    for (const line of lines) {
      if (files.length >= limit) {
        truncated = true
        break
      }

      let filePath: string
      if (isRg) {
        filePath = line
      } else if (isWindows) {
        filePath = line.trim()
      } else {
        filePath = `${cwd}/${line}`
      }

      const mtime = await getFileMtime(filePath)
      files.push({ path: filePath, mtime })
    }

    files.sort((a, b) => b.mtime - a.mtime)

    return {
      files,
      totalFiles: files.length,
      truncated: truncated || truncatedOutput,
    }
  } catch (e) {
    return {
      files: [],
      totalFiles: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
