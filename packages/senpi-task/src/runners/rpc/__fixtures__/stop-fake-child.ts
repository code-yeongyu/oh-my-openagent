import type { ChildProcess } from "node:child_process"

const FIXTURE_EXIT_BOUND_MS = 2_000

/** Fake RPC children have no descendants; stop only the owned pid, even during runner teardown. */
export async function stopFakeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = Promise.withResolvers<void>()
  const onExit = (): void => exited.resolve()
  child.once("exit", onExit)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    try {
      child.kill("SIGTERM")
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error.code !== "EPERM" && error.code !== "ESRCH")) throw error
    }
    await Promise.race([
      exited.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `fake RPC child ${child.pid} did not exit within ${FIXTURE_EXIT_BOUND_MS} ms`,
        )), FIXTURE_EXIT_BOUND_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
    child.off("exit", onExit)
  }
}
