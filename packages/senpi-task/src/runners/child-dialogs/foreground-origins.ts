import { AsyncLocalStorage } from "node:async_hooks"

export type RunInOrigin = <R>(run: () => R) => R

/**
 * Which children a parent turn is waiting on in the foreground, with that turn's async context. A child dialog
 * forwarded while its foreground wait holds is raised inside that context, so the engine targets it at the
 * connection that started the parent turn (#6189 F2d); once the wait ends (settled, promoted, aborted) the
 * child is background and its dialogs go to every attached answerer instead.
 */
export interface ForegroundDialogOrigins {
  enter(taskId: string): () => void
  originOf(taskId: string): RunInOrigin | undefined
}

export function createForegroundDialogOrigins(): ForegroundDialogOrigins {
  const origins = new Map<string, RunInOrigin>()
  return {
    enter(taskId) {
      const origin: RunInOrigin = AsyncLocalStorage.snapshot()
      origins.set(taskId, origin)
      return () => {
        if (origins.get(taskId) === origin) origins.delete(taskId)
      }
    },
    originOf: (taskId) => origins.get(taskId),
  }
}

// Task ids are unique per process, and every runner and task tool of one engine process shares it.
export const sharedForegroundDialogOrigins: ForegroundDialogOrigins = createForegroundDialogOrigins()
