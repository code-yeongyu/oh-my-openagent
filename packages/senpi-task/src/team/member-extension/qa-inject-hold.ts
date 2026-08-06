import { existsSync, watch, type FSWatcher } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Message } from "@oh-my-opencode/team-core/types"

export const QA_HOLD_AFTER_INJECT_ENV = "SENPI_TASK_QA_HOLD_AFTER_INJECT"

export function createQaAfterInjectHold(
  env: NodeJS.ProcessEnv,
): ((message: Message) => Promise<void>) | undefined {
  const markerPath = env[QA_HOLD_AFTER_INJECT_ENV]
  if (env.OMO_SENPI_QA !== "1" || markerPath === undefined || markerPath.length === 0) return undefined
  return async (message) => {
    await mkdir(dirname(markerPath), { recursive: true })
    await writeFile(markerPath, `${JSON.stringify({ messageId: message.messageId, from: message.from, to: message.to })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    await waitForRelease(`${markerPath}.release`)
  }
}

function waitForRelease(releasePath: string): Promise<void> {
  if (existsSync(releasePath)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let watcher: FSWatcher | undefined
    const close = (): void => watcher?.close()
    const complete = (): void => {
      close()
      resolve()
    }
    const fail = (error: Error): void => {
      close()
      reject(error)
    }
    watcher = watch(dirname(releasePath), () => {
      if (existsSync(releasePath)) complete()
    })
    watcher.once("error", fail)
    if (existsSync(releasePath)) complete()
  })
}
