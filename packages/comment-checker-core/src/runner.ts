import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { gracefulTerminate } from "./graceful-terminate"
import type {
  CheckResult,
  ResolveCommentCheckerBinaryInput,
  RunCommentCheckerInput,
  RunCommentCheckerOptions,
} from "./types"

const EMPTY_RESULT: CheckResult = { hasComments: false, message: "" }

export function resolveCommentCheckerBinary(input: ResolveCommentCheckerBinaryInput): string | null {
  const packageName = input.packageName ?? "@code-yeongyu/comment-checker"

  if (input.cachedBinaryPath !== null && input.existsSync(input.cachedBinaryPath)) {
    return input.cachedBinaryPath
  }

  if (input.importMetaUrl === undefined) {
    return null
  }

  try {
    const require = createRequire(input.importMetaUrl)
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const binaryPath = join(dirname(packageJsonPath), "bin", input.binaryName)
    return input.existsSync(binaryPath) ? binaryPath : null
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }
}

export async function runCommentChecker(
  input: RunCommentCheckerInput,
  options: RunCommentCheckerOptions,
): Promise<CheckResult> {
  if (input.binaryPath === null || !options.existsSync(input.binaryPath)) {
    return EMPTY_RESULT
  }

  const args = [input.binaryPath, "check"]
  if (input.customPrompt !== undefined) {
    args.push("--prompt", input.customPrompt)
  }

  const timeoutMs = options.timeoutMs ?? 30_000
  const killGraceMs = options.killGraceMs ?? 1_000
  const setTimer = options.setTimeoutFn ?? setTimeout
  const clearTimer = options.clearTimeoutFn ?? clearTimeout

  const process = options.spawn(args)
  process.stdin.write(JSON.stringify(input.hookInput))
  process.stdin.end()

  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimer(() => {
      gracefulTerminate(process, {
        gracePeriodMs: killGraceMs,
        setTimer,
        clearTimer,
      })
      resolve("timeout")
    }, timeoutMs)
  })

  try {
    const stdoutPromise = new Response(process.stdout).text()
    const stderrPromise = new Response(process.stderr).text()
    const exitCodePromise = process.exited
    const completed = Promise.all([stdoutPromise, stderrPromise, exitCodePromise] as const)
    const race = await Promise.race([completed, timeoutPromise] as const)

    if (race === "timeout") {
      return EMPTY_RESULT
    }

    const [_stdout, stderr, exitCode] = race
    if (exitCode === 0) {
      return EMPTY_RESULT
    }
    if (exitCode === 2) {
      return { hasComments: true, message: stderr }
    }

    return EMPTY_RESULT
  } catch (error) {
    if (error instanceof Error) {
      return EMPTY_RESULT
    }
    throw error
  } finally {
    if (timeoutId !== null) {
      clearTimer(timeoutId)
    }
  }
}
