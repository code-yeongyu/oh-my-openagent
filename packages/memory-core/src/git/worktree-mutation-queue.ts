import { resolve } from "node:path"

const worktreeMutationQueues = new Map<string, Promise<void>>()

export async function withSerializedGitWorktreeMutation<T>(
  dir: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const key = resolve(dir)
  const previous = worktreeMutationQueues.get(key)
  const waitForPrevious = previous?.then(
    () => undefined,
    () => undefined,
  ) ?? Promise.resolve()
  const task = waitForPrevious.then(mutate)
  const settled = task.then(
    () => undefined,
    () => undefined,
  )
  worktreeMutationQueues.set(key, settled)
  try {
    return await task
  } finally {
    if (worktreeMutationQueues.get(key) === settled) {
      worktreeMutationQueues.delete(key)
    }
  }
}
