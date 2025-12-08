import { spawn } from "bun"
import {
  resolveGrepCli,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIMIT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OUTPUT_BYTES,
  RG_FILES_FLAGS,
} from "./constants"
import type { GlobOptions, GlobResult, FileMatch } from "./types"
import { stat } from "node:fs/promises"

function buildRgArgs(options: GlobOptions): string[] {
  const args: string[] = [
    ...RG_FILES_FLAGS,
    `--max-depth=${Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)}`,
  ]

  if (options.hidden) args.push("--hidden")
  if (options.noIgnore) args.push("--no-ignore")

  args.push(`--glob=${options.pattern}`)

  return args
}

function buildFindArgs(options: GlobOptions): string[] {
  const args: string[] = ["."]

  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)
  args.push("-maxdepth", String(maxDepth))

  args.push("-type", "f")
  args.push("-name", options.pattern)

  if (!options.hidden) {
    args.push("-not", "-path", "*/.*")
  }

  return args
}

async function getFileMtime(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath)
    return stats.mtime.getTime()
  } catch {
    return 0
  }
}

export async function runRgFiles(options: GlobOptions): Promise<GlobResult> {
  const cli = resolveGrepCli()
  const timeout = Math.min(options.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT)

  const isRg = cli.backend === "rg"
  const args = isRg ? buildRgArgs(options) : buildFindArgs(options)

  const paths = options.paths?.length ? options.paths : ["."]
  if (isRg) {
    args.push(...paths)
  }

  const cwd = paths[0] || "."

  const proc = spawn([cli.path, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: isRg ? undefined : cwd,
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

      const filePath = isRg ? line : `${cwd}/${line}`
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
