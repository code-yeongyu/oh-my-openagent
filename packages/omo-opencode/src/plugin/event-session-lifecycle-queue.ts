export type SessionLifecycleQueue = (
  sessionID: string,
  task: () => Promise<void>,
) => Promise<void>

export function createSessionLifecycleQueue(): SessionLifecycleQueue {
  const tasks = new Map<string, Promise<void>>()

  return async (sessionID, task): Promise<void> => {
    const previousTask = tasks.get(sessionID)
    let release = (): void => {}
    const completion = new Promise<void>((resolve) => { release = resolve })
    const queuedTask = previousTask?.catch(() => undefined).then(() => completion) ?? completion
    tasks.set(sessionID, queuedTask)

    await previousTask?.catch(() => undefined)
    try {
      await task()
    } finally {
      release()
      if (tasks.get(sessionID) === queuedTask) tasks.delete(sessionID)
    }
  }
}
