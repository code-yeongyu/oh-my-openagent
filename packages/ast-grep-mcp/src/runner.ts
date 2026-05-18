import { spawn } from "./bun-spawn-shim"
import { existsSync } from "fs"
import {
	getSgCliPath,
	DEFAULT_TIMEOUT_MS,
} from "./constants"
import type { CliLanguage, SgResult } from "./types"

import { getAstGrepPath } from "./cli-binary-path-resolution"
import { collectProcessOutputWithTimeout } from "./process-output-timeout"
import { createSgResultFromStdout } from "./sg-compact-json-output"

export {
	ensureCliAvailable,
	getAstGrepPath,
	isCliAvailable,
	startBackgroundInit,
} from "./cli-binary-path-resolution"

export interface RunOptions {
	pattern: string
	lang: CliLanguage
	cwd?: string
	paths?: readonly string[]
	globs?: readonly string[]
	rewrite?: string
	context?: number
	updateAll?: boolean
}

export async function runSg(options: RunOptions): Promise<SgResult> {
  // ast-grep CLI silently ignores --update-all when --json is present.
  // When both rewrite and updateAll are requested, we must run two separate
  // invocations: one with --json=compact to collect match results, and
  // another with --update-all to perform the actual file writes.
  const shouldSeparateWritePass = !!(options.rewrite && options.updateAll)

  const args = createSgArgs(options, { includeJson: true, includeUpdateAll: false })

  let cliPath = getSgCliPath()

  if (!cliPath || !existsSync(cliPath)) {
    const resolvedPath = await getAstGrepPath()
    if (resolvedPath) {
      cliPath = resolvedPath
    } else {
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        error:
          `ast-grep (sg) binary not found.\n\n` +
          `Install options:\n` +
          `  bun add -D @ast-grep/cli\n` +
          `  cargo install ast-grep --locked\n` +
          `  brew install ast-grep`,
      }
    }
  }

  const timeout = DEFAULT_TIMEOUT_MS

	const proc = spawn([cliPath, ...args], {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "pipe",
	})

	let stdout: string
	let stderr: string
	let exitCode: number

	try {
		const output = await collectProcessOutputWithTimeout(proc, timeout)
		stdout = output.stdout
		stderr = output.stderr
		exitCode = output.exitCode
	} catch (error) {
		if (error instanceof Error && error.message.includes("timeout")) {
			return {
				matches: [],
				totalMatches: 0,
				truncated: true,
				truncatedReason: "timeout",
				error: error.message,
			}
		}

		const errorMessage = error instanceof Error ? error.message : String(error)
		const errorCode = errorCodeFrom(error)
		const isNoEntry =
			errorCode === "ENOENT" || errorMessage.includes("ENOENT") || errorMessage.includes("not found")

		if (isNoEntry) {
        return {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error:
            `ast-grep CLI binary not found.\n\n` +
            `Install options:\n` +
            `  bun add -D @ast-grep/cli\n` +
            `  cargo install ast-grep --locked\n` +
            `  brew install ast-grep`,
        }
      }

		return {
			matches: [],
			totalMatches: 0,
			truncated: false,
			error: `Failed to spawn ast-grep: ${errorMessage}`,
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

  const jsonResult = createSgResultFromStdout(stdout)

  if (shouldSeparateWritePass && jsonResult.matches.length > 0) {
    const writeArgs = createSgArgs(options, { includeJson: false, includeUpdateAll: true })

    const writeProc = spawn([cliPath, ...writeArgs], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
    })

    try {
      const writeOutput = await collectProcessOutputWithTimeout(writeProc, timeout)
      if (writeOutput.exitCode !== 0) {
        const errorDetail = writeOutput.stderr.trim() || `ast-grep exited with code ${writeOutput.exitCode}`
        return { ...jsonResult, error: `Replace failed: ${errorDetail}` }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { ...jsonResult, error: `Replace failed: ${errorMessage}` }
    }
  }

  return jsonResult
}

function createSgArgs(options: RunOptions, flags: { readonly includeJson: boolean; readonly includeUpdateAll: boolean }): string[] {
  const args = ["run", "-p", options.pattern, "--lang", options.lang]

  if (flags.includeJson) {
    args.push("--json=compact")
  }

  if (options.rewrite) {
    args.push("-r", options.rewrite)
    if (flags.includeUpdateAll) {
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
  args.push("--", ...paths)
  return args
}

function errorCodeFrom(error: unknown): unknown {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined
	return Reflect.get(error, "code")
}
