import type { ChildProcess } from "node:child_process"

import { terminateRpcChild } from "../terminate"

const EXITING_GROUP_BOUND_MS = 10_000

// A refused start is torn down by the runner itself after it reports the failure (#10402). A suite that
// terminates the same child afterwards can reach its process group while it exits, which macOS answers with
// EPERM; that child is already going, so wait for its exit instead of failing the hook.
export async function releaseSpawnedChild(child: ChildProcess): Promise<void> {
  try {
    await terminateRpcChild(child, { sigkillDelayMs: 200 })
  } catch (error) {
    if (!isPermissionDenied(error)) throw error
    await exitWithin(child, EXITING_GROUP_BOUND_MS)
  }
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM"
}

async function exitWithin(child: ChildProcess, boundMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const exited = new Promise<"exited">((resolve) => child.once("exit", () => resolve("exited")))
  const bound = new Promise<"left">((resolve) => {
    timer = setTimeout(() => resolve("left"), boundMs)
  })
  const outcome = await Promise.race([exited, bound])
  clearTimeout(timer)
  if (outcome === "left") throw new Error(`child ${child.pid} answered EPERM and did not exit within ${boundMs} ms`)
}
