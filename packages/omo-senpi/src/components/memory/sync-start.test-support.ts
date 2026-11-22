import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceSync, EngineStatus, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"

const dirs: string[] = []

export async function removeIdentities(): Promise<void> {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
}

export async function identity() {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-start-retry-"))
  dirs.push(root)
  const paths = buildIdentityPaths(root, "agent")
  await mkdir(join(paths.repo, ".git", "logs"), { recursive: true })
  await writeFile(join(paths.repo, ".git", "logs", "HEAD"), "")
  return paths
}

export const session = {} as SyncSession

export function stubDevice(id: number, started: number[], onClose: () => void = () => undefined): DeviceSync {
  return {
    engine: { start: () => started.push(id) } as unknown as DeviceSync["engine"],
    status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
    notifyLocalCommit: () => undefined,
    close: async () => onClose(),
  }
}

/**
 * Fails the wait with a named message when `work` has not settled after `ms` of real time. Bun's fake timers replace
 * `setTimeout` and `Bun.sleep` alike, even a reference captured before they were installed (#13706 review L5), so
 * the clock is a child process's exit.
 */
export async function within<T>(work: Promise<T>, what: string, ms = 5_000): Promise<T> {
  const clock = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { stdio: "ignore", windowsHide: true })
  let settled = false
  const breaker = new Promise<never>((_resolve, reject) => {
    clock.once("exit", () => {
      if (!settled) reject(new Error(`waited ${ms / 1000}s for ${what}, never happened`))
    })
  })
  try {
    return await Promise.race([work, breaker])
  } finally {
    settled = true
    clock.kill()
  }
}
