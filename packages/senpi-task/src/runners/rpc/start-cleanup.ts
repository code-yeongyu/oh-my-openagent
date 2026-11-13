import type { TrackedRpcChildHandle } from "./handle"

export function discardUnstartedRpcHandle(
  handle: TrackedRpcChildHandle,
  detached?: {
    readonly pending: Set<Promise<void>>
    readonly onFailure: (error: unknown) => void
  },
): Promise<void> {
  const cleanup = (async () => {
    try {
      await handle.terminate()
    } finally {
      await handle.dispose()
    }
  })()
  if (detached === undefined) return cleanup
  const settled = cleanup.catch(detached.onFailure).finally(() => detached.pending.delete(settled))
  detached.pending.add(settled)
  return settled
}
