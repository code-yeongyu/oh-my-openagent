import type { TrackedRpcChildHandle } from "./handle"

export async function discardUnstartedRpcHandle(handle: TrackedRpcChildHandle): Promise<void> {
  try {
    await handle.terminate()
  } finally {
    await handle.dispose()
  }
}
