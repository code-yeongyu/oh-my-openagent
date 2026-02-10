import { spawn } from "bun"
import { existsSync } from "fs"
import {
	getSgCliPath,
	DEFAULT_TIMEOUT_MS,
} from "./constants"
import { ensureAstGrepBinary } from "./downloader"
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
	paths?: string[]
	globs?: string[]
	rewrite?: string
	context?: number
	updateAll?: boolean
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

  if (!cliPath || !existsSync(cliPath)) {
    const downloadedPath = await getAstGrepPath()
    if (downloadedPath) {
      cliPath = downloadedPath
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
		const errorCode =
			typeof error === "object" && error !== null && "code" in error
				? (error as { code?: unknown }).code
				: undefined
		const isNoEntry =
			errorCode === "ENOENT" || errorMessage.includes("ENOENT") || errorMessage.includes("not found")

		if (isNoEntry) {
			const downloadedPath = await ensureAstGrepBinary()
			if (downloadedPath) {
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

  return createSgResultFromStdout(stdout)
}
