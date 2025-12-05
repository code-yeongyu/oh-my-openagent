import { spawn } from "bun"
import { existsSync } from "fs"
import { getSgCliPath, setSgCliPath, findSgCliPathSync } from "./constants"
import { ensureAstGrepBinary } from "./downloader"
import type { CliMatch, CliLanguage } from "./types"

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

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function spawnSg(cliPath: string, args: string[]): Promise<SpawnResult> {
  const proc = spawn([cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return { stdout, stderr, exitCode }
}

export async function runSg(options: RunOptions): Promise<CliMatch[]> {
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

  let result: SpawnResult
  try {
    result = await spawnSg(cliPath, args)
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    if (
      error.code === "ENOENT" ||
      error.message?.includes("ENOENT") ||
      error.message?.includes("not found")
    ) {
      const downloadedPath = await ensureAstGrepBinary()
      if (downloadedPath) {
        resolvedCliPath = downloadedPath
        setSgCliPath(downloadedPath)
        result = await spawnSg(downloadedPath, args)
      } else {
        throw new Error(
          `ast-grep CLI binary not found.\n\n` +
            `Auto-download failed. Manual install options:\n` +
            `  bun add -D @ast-grep/cli\n` +
            `  cargo install ast-grep --locked\n` +
            `  brew install ast-grep`
        )
      }
    } else {
      throw new Error(`Failed to spawn ast-grep: ${error.message}`)
    }
  }

  const { stdout, stderr, exitCode } = result

  if (exitCode !== 0 && stdout.trim() === "") {
    if (stderr.includes("No files found")) {
      return []
    }
    if (stderr.trim()) {
      throw new Error(stderr.trim())
    }
    return []
  }

  if (!stdout.trim()) {
    return []
  }

  try {
    return JSON.parse(stdout) as CliMatch[]
  } catch {
    return []
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
