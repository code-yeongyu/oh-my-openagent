import { rmSync as nodeRmSync } from "node:fs"
import { rm as nodeRm } from "node:fs/promises"

export const TEARDOWN_FAILURE_PREFIX = "teardown-failure:"

export type TeardownRmOptions = {
  recursive?: boolean
  force?: boolean
  maxRetries?: number
  retryDelay?: number
}

export type RmSyncFn = (path: string, options?: TeardownRmOptions) => void
export type RmAsyncFn = (path: string, options?: TeardownRmOptions) => Promise<void>
export type SleepSyncFn = (ms: number) => void
export type SleepAsyncFn = (ms: number) => Promise<void>

export type RmSyncEfaultTolerantDeps = {
  rmSync?: RmSyncFn
  sleep?: SleepSyncFn
  efaultAttempts?: number
  efaultDelayMs?: number
}

export type RmEfaultTolerantDeps = {
  rm?: RmAsyncFn
  sleep?: SleepAsyncFn
  efaultAttempts?: number
  efaultDelayMs?: number
}

const DEFAULT_OPTIONS: TeardownRmOptions = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 200,
}

const DEFAULT_EFAULT_ATTEMPTS = 3
const DEFAULT_EFAULT_DELAY_MS = 50

function defaultSleepSync(ms: number): void {
  Bun.sleepSync(ms)
}

function defaultSleepAsync(ms: number): Promise<void> {
  return Bun.sleep(ms)
}

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code
  }
  return undefined
}

function teardownFailure(path: string, attempts: number, cause: unknown): Error {
  const error = new Error(`${TEARDOWN_FAILURE_PREFIX} EFAULT persisted after ${attempts} attempts removing ${path}`)
  error.cause = cause
  return error
}

export function rmSyncEfaultTolerant(
  path: string,
  options: TeardownRmOptions = DEFAULT_OPTIONS,
  deps: RmSyncEfaultTolerantDeps = {},
): void {
  const rm = deps.rmSync ?? nodeRmSync
  const sleep = deps.sleep ?? defaultSleepSync
  const attempts = deps.efaultAttempts ?? DEFAULT_EFAULT_ATTEMPTS
  const delayMs = deps.efaultDelayMs ?? DEFAULT_EFAULT_DELAY_MS
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rm(path, options)
      return
    } catch (error) {
      if (errorCode(error) !== "EFAULT") throw error
      lastError = error
      if (attempt + 1 < attempts) sleep(delayMs)
    }
  }
  throw teardownFailure(path, attempts, lastError)
}

export async function rmEfaultTolerant(
  path: string,
  options: TeardownRmOptions = DEFAULT_OPTIONS,
  deps: RmEfaultTolerantDeps = {},
): Promise<void> {
  const rm = deps.rm ?? nodeRm
  const sleep = deps.sleep ?? defaultSleepAsync
  const attempts = deps.efaultAttempts ?? DEFAULT_EFAULT_ATTEMPTS
  const delayMs = deps.efaultDelayMs ?? DEFAULT_EFAULT_DELAY_MS
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, options)
      return
    } catch (error) {
      if (errorCode(error) !== "EFAULT") throw error
      lastError = error
      if (attempt + 1 < attempts) await sleep(delayMs)
    }
  }
  throw teardownFailure(path, attempts, lastError)
}
