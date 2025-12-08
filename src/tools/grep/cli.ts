import { spawn } from "bun"
import {
  resolveGrepCli,
  type GrepBackend,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILESIZE,
  DEFAULT_MAX_COUNT,
  DEFAULT_MAX_COLUMNS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  RG_SAFETY_FLAGS,
  GREP_SAFETY_FLAGS,
} from "./constants"
import type { GrepOptions, GrepMatch, GrepResult, CountResult } from "./types"

function buildRgArgs(options: GrepOptions): string[] {
  const args: string[] = [
    ...RG_SAFETY_FLAGS,
    `--max-depth=${Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH)}`,
    `--max-filesize=${options.maxFilesize ?? DEFAULT_MAX_FILESIZE}`,
    `--max-count=${Math.min(options.maxCount ?? DEFAULT_MAX_COUNT, DEFAULT_MAX_COUNT)}`,
    `--max-columns=${Math.min(options.maxColumns ?? DEFAULT_MAX_COLUMNS, DEFAULT_MAX_COLUMNS)}`,
  ]

  if (options.context !== undefined && options.context > 0) {
    args.push(`-C${Math.min(options.context, 10)}`)
  }

  if (options.caseSensitive) args.push("--case-sensitive")
  if (options.wholeWord) args.push("-w")
  if (options.fixedStrings) args.push("-F")
  if (options.multiline) args.push("-U")
  if (options.hidden) args.push("--hidden")
  if (options.noIgnore) args.push("--no-ignore")

  if (options.fileType?.length) {
    for (const type of options.fileType) {
      args.push(`--type=${type}`)
    }
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push(`--glob=${glob}`)
    }
  }

  if (options.excludeGlobs) {
    for (const glob of options.excludeGlobs) {
      args.push(`--glob=!${glob}`)
    }
  }

  return args
}

function buildGrepArgs(options: GrepOptions): string[] {
  const args: string[] = [...GREP_SAFETY_FLAGS, "-r"]

  if (options.context !== undefined && options.context > 0) {
    args.push(`-C${Math.min(options.context, 10)}`)
  }

  if (!options.caseSensitive) args.push("-i")
  if (options.wholeWord) args.push("-w")
  if (options.fixedStrings) args.push("-F")

  if (options.globs?.length) {
    for (const glob of options.globs) {
      args.push(`--include=${glob}`)
    }
  }

  if (options.excludeGlobs?.length) {
    for (const glob of options.excludeGlobs) {
      args.push(`--exclude=${glob}`)
    }
  }

  args.push("--exclude-dir=.git", "--exclude-dir=node_modules")

  return args
}

function buildArgs(options: GrepOptions, backend: GrepBackend): string[] {
  return backend === "rg" ? buildRgArgs(options) : buildGrepArgs(options)
}

function parseOutput(output: string): GrepMatch[] {
  if (!output.trim()) return []

  const matches: GrepMatch[] = []
  const lines = output.split("\n")

  for (const line of lines) {
    if (!line.trim()) continue

    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (match) {
      matches.push({
        file: match[1],
        line: parseInt(match[2], 10),
        text: match[3],
      })
    }
  }

  return matches
}

function parseCountOutput(output: string): CountResult[] {
  if (!output.trim()) return []

  const results: CountResult[] = []
  const lines = output.split("\n")

  for (const line of lines) {
    if (!line.trim()) continue

    const match = line.match(/^(.+?):(\d+)$/)
    if (match) {
      results.push({
        file: match[1],
        count: parseInt(match[2], 10),
      })
    }
  }

  return results
}

export async function runRg(options: GrepOptions): Promise<GrepResult> {
  const cli = resolveGrepCli()
  const args = buildArgs(options, cli.backend)
  const timeout = Math.min(options.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)

  if (cli.backend === "rg") {
    args.push("--", options.pattern)
  } else {
    args.push("-e", options.pattern)
  }

  const paths = options.paths?.length ? options.paths : ["."]
  args.push(...paths)
  const proc = spawn([cli.path, ...args], {
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

  try {
    const stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    const truncated = stdout.length >= DEFAULT_MAX_OUTPUT_BYTES
    const outputToProcess = truncated ? stdout.substring(0, DEFAULT_MAX_OUTPUT_BYTES) : stdout

    if (exitCode > 1 && stderr.trim()) {
      return {
        matches: [],
        totalMatches: 0,
        filesSearched: 0,
        truncated: false,
        error: stderr.trim(),
      }
    }

    const matches = parseOutput(outputToProcess)
    const filesSearched = new Set(matches.map((m) => m.file)).size

    return {
      matches,
      totalMatches: matches.length,
      filesSearched,
      truncated,
    }
  } catch (e) {
    return {
      matches: [],
      totalMatches: 0,
      filesSearched: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function runRgCount(options: Omit<GrepOptions, "context">): Promise<CountResult[]> {
  const cli = resolveGrepCli()
  const args = buildArgs({ ...options, context: 0 }, cli.backend)

  if (cli.backend === "rg") {
    args.push("--count", "--", options.pattern)
  } else {
    args.push("-c", "-e", options.pattern)
  }

  const paths = options.paths?.length ? options.paths : ["."]
  args.push(...paths)

  const timeout = Math.min(options.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const proc = spawn([cli.path, ...args], {
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

  try {
    const stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
    return parseCountOutput(stdout)
  } catch (e) {
    throw new Error(`Count search failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
