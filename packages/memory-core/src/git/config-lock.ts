import { resolve } from "node:path"

const CONFIG_LOCK_ERROR = /(could not lock config file|unable to create '[^']*config\.lock')/i
const ATTEMPTS = 5
const BASE_DELAY_MS = 25
const mutationQueues = new Map<string, Promise<void>>()

export function isGitConfigLockError(error: unknown): boolean {
  return CONFIG_LOCK_ERROR.test(error instanceof Error ? error.message : String(error))
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
