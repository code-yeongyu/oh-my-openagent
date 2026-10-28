import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { onTestFinished } from "bun:test"
import { createCredentialStore, credentialId, INTERACTIVE_READ_WAIT, SESSION_READ_WAIT, type SecretApi } from "../keystore"
import type { Credentials } from "../protocol"
import { createSession } from "../session"
import { grant, privateKeys } from "../test-support"
import type { HelperAccess } from "./access"
import { createApprovalCache } from "./approval-cache"
import type { HelperCall, HelperLease, HelperReply } from "./client"
import { OLD_SLOT_COUNT, oldSlotName } from "./recovery"

export type Owner = "helper" | "bun" | "runtime"
type Item = { value: string; owner: Owner; partition: "ours" | "other" | "none"; marker: boolean; cdat: number; mdat: number }

export const credentials: Credentials = { ...grant, ...privateKeys }
export const API = "https://api.example.test"
export const A = credentialId(API)

/**
 * An in-memory keychain with the measured semantics of #11262 design 8: data reads by a non-owner are refused, an
 * overwrite keeps the item's owner (m5), a rename works for anyone (m10), a delete by a non-owner is refused (m6).
 * `secrets` is this process's own identity (`bun`); `access` is the signed helper, which counts every approve dialog.
 */
export function fakeKeychain(options: { readonly approve?: "allow" | "deny" | "locked"; readonly approveGate?: Promise<void>; readonly onApprove?: () => void } = {}) {
  const items = new Map<string, Item>()
  let clock = 1_000
  const events: string[] = []
  const stats = { approves: 0, unleasedMutations: 0 }
  const put = (name: string, value: string, owner: Owner, partition: Item["partition"] = "none") =>
    items.set(name, { value, owner, partition, marker: owner === "helper", cdat: ++clock, mdat: clock })

  const secrets: SecretApi = {
    get: async ({ name }) => {
      const item = items.get(name)
      if (item === undefined) return null
      if (item.owner !== "bun") throw new Error("SecKeychainSearchCopyNext: -25293")
      return item.value
    },
    set: async ({ name, value }) => {
      const item = items.get(name)
      if (item === undefined) put(name, value, "bun", "other")
      else items.set(name, { ...item, value, mdat: ++clock })
    },
    delete: async ({ name }) => {
      const item = items.get(name)
      if (item === undefined) return false
      if (item.owner !== "bun") throw new Error("-25244")
      items.delete(name)
      return true
    },
  }

  const slots = (base: string) => Array.from({ length: OLD_SLOT_COUNT }, (_, slot) => slot).filter(slot => items.has(oldSlotName(base, slot)))
  const present = (base: string) => ({ staging: items.has(`${base}.staging`), old: slots(base).length > 0, oldSlots: slots(base) })
  const rename = (from: string, to: string): HelperReply => {
    const item = items.get(from)
    if (item === undefined) return { error: "missing" }
    if (items.has(to)) return { error: "exists" }
    items.delete(from)
    items.set(to, { ...item, mdat: ++clock })
    return { ok: true }
  }
  const call = async (request: HelperCall, lease?: HelperLease): Promise<HelperReply> => {
    events.push(`${request.verb} ${request.account.slice(64) || "<A>"}`)
    if (request.verb !== "read" && request.verb !== "approve" && lease === undefined) stats.unleasedMutations++
    const name = request.account
    const item = items.get(name)
    switch (request.verb) {
      case "read": {
        if (item !== undefined && item.owner === "helper") return { owned: true, value: item.value, marker: item.marker, cdat: item.cdat, mdat: item.mdat, present: present(name) }
        if (item !== undefined) return { owned: false, marker: false, cdat: item.cdat, mdat: item.mdat, partition: item.partition, present: present(name) }
        const staged = items.get(`${name}.staging`)
        if (staged?.owner === "helper") return { owned: true, value: staged.value, recover: true, marker: true, cdat: staged.cdat, mdat: staged.mdat, present: present(name) }
        return { missing: true, present: present(name) }
      }
      case "approve": {
        stats.approves++
        options.onApprove?.()
        await options.approveGate
        if (item === undefined) return { missing: true }
        if (options.approve === "deny") return { error: "denied" }
        if (options.approve === "locked") return { error: "locked" }
        return { value: item.value, marker: item.marker, cdat: item.cdat, mdat: item.mdat }
      }
      case "write":
      case "stage": {
        const target = request.verb === "stage" ? `${name}.staging` : name
        const existing = items.get(target)
        if (existing !== undefined && existing.owner !== "helper") return { error: "not-owned" }
        if (existing === undefined) put(target, request.value ?? "", "helper")
        else items.set(target, { ...existing, value: request.value ?? "", mdat: ++clock })
        return existing === undefined ? { ok: true, created: true } : { ok: true }
      }
      case "retire": {
        for (let slot = 0; slot < OLD_SLOT_COUNT; slot++) {
          const renamed = rename(name, oldSlotName(name, slot))
          if (renamed.error !== "exists") return renamed.ok === true ? { ok: true, slot } : renamed
        }
        return { error: "exists", reason: "old-slots-full" }
      }
      case "promote":
        return rename(`${name}.staging`, name)
      case "remove": {
        if (item === undefined) return { ok: true, missing: true }
        if (item.owner !== "helper") return { error: "not-owned" }
        items.delete(name)
        return { ok: true }
      }
    }
  }
  const access: HelperAccess = { kind: "ready", path: "/fake/omo-keychain", call }
  // One process's approval cache per fake machine, so one test's approval never serves another test.
  const cache = createApprovalCache()
  return { items, events, stats, secrets, access, put, cache }
}

export async function helperSession(keychain: ReturnType<typeof fakeKeychain>, background = false) {
  const home = await mkdtemp(join(tmpdir(), "omo-helper-session-"))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = createCredentialStore(API, {
    secrets: keychain.secrets,
    platform: "darwin",
    lockProbe: async () => "unlocked",
    notice: () => {},
    wait: background ? SESSION_READ_WAIT : INTERACTIVE_READ_WAIT,
    keychainHelper: { access: async () => keychain.access, home, silently: run => run(), ownerMarker: async () => "absent", cache: keychain.cache },
  })
  return { store, session: createSession({ api: API, store, home }), home }
}
