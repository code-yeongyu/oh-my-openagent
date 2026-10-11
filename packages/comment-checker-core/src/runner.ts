import { createRequire } from "node:module"

import { COMMENT_CHECKER_PACKAGE_NAME, findCommentCheckerPackageBinary, isModuleResolutionMiss } from "./package-binary"

import type {
  CheckResult,
  ResolveCommentCheckerBinaryInput,
  RunCommentCheckerInput,
  RunCommentCheckerOptions,
  SpawnProcess,
  SpawnSignal,
} from "./types"

const EMPTY_RESULT: CheckResult = { hasComments: false, message: "" }
const MAX_FAILURE_STDERR = 500

type ExitOutcome = { readonly kind: "exited"; readonly code: number } | { readonly kind: "not-started"; readonly reason: string }

function normalizeMessage(message: string): string {
  return message.replace(/\r\n/g, "\n")
}

function failed(exitCode: number | null, stderr: string): CheckResult {
  return { ...EMPTY_RESULT, failure: { exitCode, stderr: normalizeMessage(stderr).trim().slice(0, MAX_FAILURE_STDERR) } }
}

function readText(stream: ReadableStream<Uint8Array>): Promise<string | undefined> {
  return new Response(stream).text().then(
    (text) => text,
    () => undefined,
  )
}

function killProcessSafely(process: SpawnProcess, signal: SpawnSignal): void {
  try {
    process.kill(signal)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
  }
}

export function resolveCommentCheckerBinary(input: ResolveCommentCheckerBinaryInput): string | null {
  const packageName = input.packageName ?? COMMENT_CHECKER_PACKAGE_NAME

  if (input.cachedBinaryPath !== null && input.existsSync(input.cachedBinaryPath)) {
    return input.cachedBinaryPath
  }

  if (input.importMetaUrl === undefined) {
    return null
  }

  try {
    const require = createRequire(input.importMetaUrl)
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    return findCommentCheckerPackageBinary({
      packageJsonPath,
      packageName,
      binaryName: input.binaryName,
      existsSync: input.existsSync,
    })
  } catch (error) {
    if (isModuleResolutionMiss(error)) return null
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
      return failed(null, error.message)
    }
    throw error
  }
  const spawned = process
  const inputDelivered = spawned.stdin.send(JSON.stringify(input.hookInput)).then(
    () => true,
    () => {
      killProcessSafely(spawned, "SIGKILL")
      return false
    },
  )

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let graceId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimer(() => {
      killProcessSafely(process, "SIGTERM")

      graceId = setTimer(() => {
        killProcessSafely(process, "SIGKILL")
      }, killGraceMs)

      resolve("timeout")
    }, timeoutMs)
  })

  try {
    const stdoutPromise = readText(process.stdout)
    const stderrPromise = readText(process.stderr)
    // A spawn error (EACCES, ENOEXEC, ENOENT) rejects `exited`; under Bun it also aborts the output
    // streams, so neither may hide that the checker never started (#8850).
    const exitPromise = process.exited.then(
      (code): ExitOutcome => ({ kind: "exited", code }),
      (error: unknown): ExitOutcome => ({ kind: "not-started", reason: error instanceof Error ? error.message : String(error) }),
    )
    const completed = Promise.all([stdoutPromise, stderrPromise, exitPromise, inputDelivered] as const)
    const race = await Promise.race([completed, timeoutPromise] as const)

    if (race === "timeout") {
      return EMPTY_RESULT
    }

    const [_stdout, stderr, exit, delivered] = race
    if (exit.kind === "not-started") {
      return failed(null, exit.reason)
    }
    if (exit.code === 0) {
      return EMPTY_RESULT
    }
    if (exit.code === 2) {
      // Feedback about input the checker never fully read is not trustworthy.
      return delivered && stderr !== undefined ? { hasComments: true, message: normalizeMessage(stderr) } : EMPTY_RESULT
    }
    // Outside the protocol, whether or not the input was delivered: a checker that cannot start
    // exits before reading stdin, and that is the case callers need to see (#8850).

    return failed(exit.code, stderr ?? "")
  } catch (error) {
    if (error instanceof Error) {
      return EMPTY_RESULT
    }
    throw error
  } finally {
    if (timeoutId !== null) {
      clearTimer(timeoutId)
    }
    if (graceId !== null) {
      clearTimer(graceId)
    }
  }
}
