import { resolve } from "node:path"

const CONFIG_LOCK_ERROR = /(could not lock config file|unable to create '[^']*config\.lock')/i
const LOCK_CONTENTION_ERROR =
  /(could not lock config file|unable to create '[^']*\.lock'|cannot lock ref|another git process seems to be running)/i
const ATTEMPTS = 5
const BASE_DELAY_MS = 25
const mutationQueues = new Map<string, Promise<void>>()

export function isGitConfigLockError(error: unknown): boolean {
  return CONFIG_LOCK_ERROR.test(errorText(error))
}

/**
 * Git serialises index, ref and config writes behind `*.lock` files. Under
 * concurrency the loser of the race fails immediately instead of waiting, which
 * surfaces as a transient failure rather than a real defect. Windows loses these
 * races far more often because file handles are released more slowly.
 */
export function isGitLockError(error: unknown): boolean {
  return LOCK_CONTENTION_ERROR.test(errorText(error))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function withSerializedGitConfigMutation(
  dir: string,
  mutate: () => Promise<void>,
): Promise<void> {
  const key = resolve(dir)
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  const task = previous.catch(() => undefined).then(() => retryConfigMutation(mutate))
  mutationQueues.set(key, task)
  try {
    await task
  } finally {
    if (mutationQueues.get(key) === task) mutationQueues.delete(key)
  }
}

export async function withGitLockRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isGitLockError(error) || attempt === ATTEMPTS) throw error
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
  throw new Error("unreachable: git lock retry exhausted without result")
}

async function retryConfigMutation(mutate: () => Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await mutate()
      return
    } catch (error) {
      if (!isGitConfigLockError(error) || attempt === ATTEMPTS) throw error
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}
