import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { type Check, repoPath } from "./preflight.ts"
import type { OsName } from "./vocabulary.ts"

export type ObserverStatus = { readonly kind: "records" } | { readonly kind: "unavailable"; readonly reason: string }

type RecordsOn = (os: OsName) => boolean

const REPO = resolve(import.meta.dir, "../../../..")

function recordsOnOf(loaded: unknown): RecordsOn | undefined {
  if (typeof loaded !== "object" || loaded === null || !("recordsOn" in loaded)) return undefined
  const recordsOn = loaded.recordsOn
  if (typeof recordsOn !== "function") return undefined
  return (os) => recordsOn(os) === true
}

/**
 * A missing sentinel module, or one that cannot say which OSes it records, is an environment fault. A sentinel
 * that exists but records no signal on this OS lets the run go on: its cells read every signal as not_observed.
 */
export async function observerCheck(sentinel: string, os: OsName): Promise<{ check: Check; status: ObserverStatus }> {
  if (!existsSync(sentinel)) {
    const detail = `${repoPath(REPO, sentinel)} (row 3) is not on this checkout`
    return { check: { name: "desktop-observer", ok: false, detail }, status: { kind: "unavailable", reason: detail } }
  }
  const recordsOn = recordsOnOf(await import(sentinel))
  if (recordsOn === undefined) {
    const detail = `${repoPath(REPO, sentinel)} does not export recordsOn(os)`
    return { check: { name: "desktop-observer", ok: false, detail }, status: { kind: "unavailable", reason: detail } }
  }
  if (recordsOn(os))
    return { check: { name: "desktop-observer", ok: true, detail: sentinel }, status: { kind: "records" } }
  const reason = `no ${os} recorder in the sentinel yet`
  return {
    check: { name: "desktop-observer", ok: true, detail: `unavailable: ${reason}` },
    status: { kind: "unavailable", reason },
  }
}
