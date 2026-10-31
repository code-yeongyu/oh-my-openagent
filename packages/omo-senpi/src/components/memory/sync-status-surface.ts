// What the TUI tells a person about memory sync (#10637): the footer shows ` sync blocked` while a
// failure is shown (status.ts), and one notice says why and what to do when it starts or changes
// kind, then one more when sync recovers. The engine reports transitions only, so a cycle that
// keeps failing the same way never repeats the notice.

import type { EngineStatus } from "@oh-my-opencode/memory-core/sync-engine"

import type { SyncConfigInvalidStatus, SyncUnavailableStatus } from "./sync-runner"

// The runner also reports an invalid sync configuration (#10860); like "unavailable" it is not a failing cycle,
// so the footer and the notice treat it the same way (the runner already logs why sync is off).
export type SyncStatusReader = (repo: string) => Promise<EngineStatus | SyncUnavailableStatus | SyncConfigInvalidStatus | null>

export interface SyncNoticeUi {
  notify(message: string, level: "info" | "warning" | "error"): void
}

export interface SyncStatusNotifier {
  changed(repo: string, ui: SyncNoticeUi | undefined): Promise<void>
}

export const SYNC_RECOVERED_NOTICE = "Memory sync is working again."

export function createSyncStatusNotifier(read: SyncStatusReader): SyncStatusNotifier {
  const announced = new Map<string, string>()
  return {
    async changed(repo, ui) {
      // A failed read says nothing about sync, so it changes no notice; the next change reads again.
      const status = await read(repo).catch(() => undefined)
      if (status === undefined) return
      const failure = status?.kind === "failing" ? status.failure : undefined
      const previous = announced.get(repo)
      if (failure === undefined) {
        announced.delete(repo)
        if (previous !== undefined) ui?.notify(SYNC_RECOVERED_NOTICE, "info")
        return
      }
      const key = `${failure.kind}\n${failure.action}`
      // Background transitions must not consume a notice the person has never seen.
      if (previous === key || ui === undefined) return
      ui.notify(`Memory sync is blocked. ${failure.reason} ${failure.action}`, "warning")
      announced.set(repo, key)
    },
  }
}

export interface SyncStatusChange {
  readonly repo: string
  /** Whether the repo belongs to the active session; only that session's footer and notices show it. */
  readonly isActiveRepo: boolean
  readonly notifier: SyncStatusNotifier | undefined
  readonly ui: SyncNoticeUi | undefined
  readonly refreshFooter: () => void
  readonly pushRpc: () => Promise<void>
}

/** One engine status change, delivered to the notice, the footer and the desktop snapshot. A repo that is not
 * the active session's still feeds the notifier (with no UI), so its notice state follows every transition. */
export async function deliverSyncStatusChange(change: SyncStatusChange): Promise<void> {
  if (!change.isActiveRepo) {
    await change.notifier?.changed(change.repo, undefined)
    return
  }
  await change.notifier?.changed(change.repo, change.ui)
  change.refreshFooter()
  await change.pushRpc()
}
