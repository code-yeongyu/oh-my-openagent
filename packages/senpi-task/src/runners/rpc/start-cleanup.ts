import type { TrackedRpcChildHandle } from "./handle"

/**
 * Tears down a handle whose first prompt was refused, without holding the caller's start failure up.
 * The refusal already decides the start outcome; process-tree teardown (taskkill on Windows) can outlast
 * the manager's start-report window, and awaiting it there turned a refused start into "started" (#10402).
 * The returned promise settles once teardown has finished and never rejects: a failure goes to onFailure.
 */
export function discardUnstartedRpcHandle(
  handle: Pick<TrackedRpcChildHandle, "terminate" | "dispose">,
  onFailure: (error: unknown) => void,
): Promise<void> {
  const teardown = async (): Promise<void> => {
    try {
      await handle.terminate()
    } finally {
      await handle.dispose()
    }
  }
  return teardown().catch(onFailure)
}
