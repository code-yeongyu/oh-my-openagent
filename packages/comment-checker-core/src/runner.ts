import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type {
  CheckResult,
  ResolveCommentCheckerBinaryInput,
  RunCommentCheckerInput,
  RunCommentCheckerOptions,
  SpawnProcess,
  SpawnSignal,
} from "./types"

const EMPTY_RESULT: CheckResult = { hasComments: false, message: "" }

function normalizeMessage(message: string): string {
  return message.replace(/\r\n/g, "\n")
}

function tryKillProcess(process: SpawnProcess, signal: SpawnSignal): boolean {
  try {
    process.kill(signal)
    return true
  } catch {
    return false
  }
}

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

  let process: SpawnProcess
  try {
    process = options.spawn(args)
  } catch (error) {
    if (error instanceof Error) {
      return EMPTY_RESULT
    }
    throw error
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let graceId: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  const clearGraceTimer = () => {
    if (graceId !== null) {
      clearTimer(graceId)
      graceId = null
    }
  }
  void process.exited.then(clearGraceTimer, clearGraceTimer)

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimer(() => {
      timedOut = true
      void tryKillProcess(process, "SIGTERM")

      graceId = setTimer(() => {
        void tryKillProcess(process, "SIGKILL")
      }, killGraceMs)
      resolve("timeout")
    }, timeoutMs)
  })

  try {
    process.stdin.write(JSON.stringify(input.hookInput))
    process.stdin.end()

    const stdoutPromise = new Response(process.stdout).text()
    const stderrPromise = new Response(process.stderr).text()
    const exitCodePromise = process.exited
    const completed = Promise.all([stdoutPromise, stderrPromise, exitCodePromise] as const)
    const race = await Promise.race([completed, timeoutPromise] as const)

    if (race === "timeout" || timedOut) {
      return EMPTY_RESULT
    }

    const [_stdout, stderr, exitCode] = race
    if (exitCode === 0) {
      return EMPTY_RESULT
    }
    if (exitCode === 2) {
      return { hasComments: true, message: normalizeMessage(stderr) }
    }

    return EMPTY_RESULT
  } catch (error) {
    void tryKillProcess(process, "SIGKILL")
    if (error instanceof Error) {
      return EMPTY_RESULT
    }
    throw error
  } finally {
    if (timeoutId !== null) {
      clearTimer(timeoutId)
    }
    if (!timedOut) clearGraceTimer()
  }
}
