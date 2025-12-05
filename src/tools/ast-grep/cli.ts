import { spawn } from "bun"
import { existsSync } from "fs"
import {
  getSgCliPath,
  setSgCliPath,
  findSgCliPathSync,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_MATCHES,
} from "./constants"
import { ensureAstGrepBinary } from "./downloader"
import type { CliMatch, CliLanguage, SgResult } from "./types"

export interface RunOptions {
  pattern: string
  lang: CliLanguage
  paths?: string[]
  globs?: string[]
  rewrite?: string
  context?: number
  updateAll?: boolean
}

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getAstGrepPath(): Promise<string | null> {
  if (resolvedCliPath !== null && existsSync(resolvedCliPath)) {
    return resolvedCliPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const syncPath = findSgCliPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      setSgCliPath(syncPath)
      return syncPath
    }

    const downloadedPath = await ensureAstGrepBinary()
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      setSgCliPath(downloadedPath)
      return downloadedPath
    }

    return null
  })()

  return initPromise
}

export function startBackgroundInit(): void {
  if (!initPromise) {
    initPromise = getAstGrepPath()
    initPromise.catch(() => {})
  }
}

export async function runSg(options: RunOptions): Promise<SgResult> {
  const args = ["run", "-p", options.pattern, "--lang", options.lang, "--json=compact"]

  if (options.rewrite) {
    args.push("-r", options.rewrite)
    if (options.updateAll) {
      args.push("--update-all")
    }
  }

  if (options.context && options.context > 0) {
    args.push("-C", String(options.context))
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob)
    }
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ["."]
  args.push(...paths)

  let cliPath = getSgCliPath()

  if (!existsSync(cliPath) && cliPath !== "sg") {
    const downloadedPath = await getAstGrepPath()
    if (downloadedPath) {
      cliPath = downloadedPath
    }
  }

  const timeout = DEFAULT_TIMEOUT_MS

  const proc = spawn([cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const timeoutPromise = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      proc.kill()
      reject(new Error(`Search timeout after ${timeout}ms`))
    }, timeout)
    proc.exited.then(() => clearTimeout(id))
  })

  let stdout: string
  let stderr: string
  let exitCode: number

  try {
    stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
    stderr = await new Response(proc.stderr).text()
    exitCode = await proc.exited
  } catch (e) {
    const error = e as Error
    if (error.message?.includes("timeout")) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: true,
        truncatedReason: "timeout",
        error: error.message,
      }
    }

    const nodeError = e as NodeJS.ErrnoException
    if (
      nodeError.code === "ENOENT" ||
      nodeError.message?.includes("ENOENT") ||
      nodeError.message?.includes("not found")
    ) {
      const downloadedPath = await ensureAstGrepBinary()
      if (downloadedPath) {
        resolvedCliPath = downloadedPath
        setSgCliPath(downloadedPath)
        return runSg(options)
      } else {
        return {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error:
            `ast-grep CLI binary not found.\n\n` +
            `Auto-download failed. Manual install options:\n` +
            `  bun add -D @ast-grep/cli\n` +
            `  cargo install ast-grep --locked\n` +
            `  brew install ast-grep`,
        }
      }
    }

    return {
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: `Failed to spawn ast-grep: ${error.message}`,
    }
  }

  if (exitCode !== 0 && stdout.trim() === "") {
    if (stderr.includes("No files found")) {
      return { matches: [], totalMatches: 0, truncated: false }
    }
    if (stderr.trim()) {
      return { matches: [], totalMatches: 0, truncated: false, error: stderr.trim() }
    }
    return { matches: [], totalMatches: 0, truncated: false }
  }

  if (!stdout.trim()) {
    return { matches: [], totalMatches: 0, truncated: false }
  }

  const outputTruncated = stdout.length >= DEFAULT_MAX_OUTPUT_BYTES
  const outputToProcess = outputTruncated ? stdout.substring(0, DEFAULT_MAX_OUTPUT_BYTES) : stdout

  let matches: CliMatch[] = []
  try {
    matches = JSON.parse(outputToProcess) as CliMatch[]
  } catch {
    if (outputTruncated) {
      try {
        const lastValidIndex = outputToProcess.lastIndexOf("}")
        if (lastValidIndex > 0) {
          const bracketIndex = outputToProcess.lastIndexOf("},", lastValidIndex)
          if (bracketIndex > 0) {
            const truncatedJson = outputToProcess.substring(0, bracketIndex + 1) + "]"
            matches = JSON.parse(truncatedJson) as CliMatch[]
          }
        }
      } catch {
        return {
          matches: [],
          totalMatches: 0,
          truncated: true,
          truncatedReason: "max_output_bytes",
          error: "Output too large and could not be parsed",
        }
      }
    } else {
      return { matches: [], totalMatches: 0, truncated: false }
    }
  }

  const totalMatches = matches.length
  const matchesTruncated = totalMatches > DEFAULT_MAX_MATCHES
  const finalMatches = matchesTruncated ? matches.slice(0, DEFAULT_MAX_MATCHES) : matches

  return {
    matches: finalMatches,
    totalMatches,
    truncated: outputTruncated || matchesTruncated,
    truncatedReason: outputTruncated ? "max_output_bytes" : matchesTruncated ? "max_matches" : undefined,
  }
}

export function isCliAvailable(): boolean {
  const path = findSgCliPathSync()
  return path !== null && existsSync(path)
}

export async function ensureCliAvailable(): Promise<boolean> {
  const path = await getAstGrepPath()
  return path !== null && existsSync(path)
}
