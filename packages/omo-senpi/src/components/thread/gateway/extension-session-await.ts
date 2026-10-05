import { existsSync, watch, type FSWatcher } from "node:fs"
import { basename, dirname } from "node:path"

import type { StoreExtensionResult } from "./store-extensions"

export type SessionAwait = {
  /** `<dirname(store file)>/<wakeDir>/<await_request_id>`: the connector touches it after its completion commits. */
  readonly file: string
  readonly timeoutMs: number
  readonly status: () => Promise<StoreExtensionResult<unknown>>
  readonly expire: () => Promise<StoreExtensionResult<unknown>>
  /** Test seam (the store's `_test.onAwaitArmed`): called once, when the watch is armed and a status read answered not final, just before the first wait. */
  readonly onArmed?: () => void
}

/** A status or expire call that throws (the worker exited mid-call, a reopen hit the lock-wait bound) answers like a refusal, so it never ends the wait early. */
async function settle(read: () => Promise<StoreExtensionResult<unknown>>): Promise<StoreExtensionResult<unknown>> {
  try {
    return await read()
  } catch (error) {
    return { kind: "refused", code: "extension_operation_failed", message: error instanceof Error ? error.message : String(error) }
  }
}

/** Only a status the op itself reports as not `pending` is final; a refused status call never is. */
function final(result: StoreExtensionResult<unknown>): boolean {
  if (result.kind !== "ok") return false
  const value = result.value
  return !(typeof value === "object" && value !== null && (value as { readonly status?: unknown }).status === "pending")
}

function unresolved(id: string, why: string): StoreExtensionResult<unknown> {
  return {
    kind: "refused",
    code: "await_unresolved",
    message: `The request ${id} has no final status: ${why}. It may still complete; read its status again before retrying, so a retry does not repeat it.`,
  }
}

/** The deadline: `expire`, then one final `status`. Anything but a final status is `await_unresolved`, never a plain failure. */
async function expireAndRead(request: SessionAwait): Promise<StoreExtensionResult<unknown>> {
  const id = basename(request.file)
  const expired = await settle(request.expire)
  if (expired.kind !== "ok") return unresolved(id, `expiring it was refused (${expired.code}: ${expired.message})`)
  const last = await settle(request.status)
  if (final(last)) return last
  return unresolved(id, last.kind === "ok" ? "its status still reads pending after it was expired" : `its status after expiry was refused (${last.code}: ${last.message})`)
}

/**
 * Waits for a session op's await without polling. The watch on the wake file and its directory is
 * armed FIRST, then `status` runs once (a completion that landed before the watch is caught here),
 * then every wake re-checks `status`. Only a final status ends the wait: a refused status call (the
 * lock held past its bound, a failed import) keeps waiting. At `timeoutMs`, `expire` runs and then
 * `status` once more, so an open that completes during the expiry still returns as opened. A missing
 * wake directory means no connector has started, so nothing can complete the request: it expires at
 * once instead of making the caller wait `timeoutMs`. A dropped event costs at most `timeoutMs`,
 * never correctness.
 */
export async function awaitSessionRequest(request: SessionAwait): Promise<StoreExtensionResult<unknown>> {
  let woken = false
  let wake: (() => void) | undefined
  const signal = (): void => {
    woken = true
    wake?.()
  }
  if (!existsSync(dirname(request.file))) {
    const current = await settle(request.status)
    return final(current) ? current : await expireAndRead(request)
  }
  const name = basename(request.file)
  const watchers: FSWatcher[] = []
  for (const [path, only] of [[dirname(request.file), name], [request.file, undefined]] as const) {
    try {
      const watcher = watch(path, (_event, filename) => {
        if (only === undefined || filename === null || String(filename) === only) signal()
      })
      watcher.on("error", () => undefined)
      watchers.push(watcher)
    } catch {
      // Not there yet: the other watch, or the deadline, covers it.
    }
  }
  const deadline = Date.now() + request.timeoutMs
  let announced = false
  try {
    for (;;) {
      woken = false
      const current = await settle(request.status)
      if (final(current)) return current
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      if (woken) continue
      if (!announced) {
        announced = true
        request.onArmed?.()
      }
      const arrived = await new Promise<boolean>((resolve) => {
        if (woken) {
          resolve(true)
          return
        }
        const timer = setTimeout(() => resolve(false), remaining)
        wake = () => {
          clearTimeout(timer)
          resolve(true)
        }
      })
      wake = undefined
      if (!arrived) break
    }
    return await expireAndRead(request)
  } finally {
    for (const watcher of watchers) watcher.close()
  }
}
