import type { DeviceKeyring } from "../keyring-port.ts"
import { isVerifiedWrap } from "./chain.ts"
import type { VerifiedWrap } from "./entry.ts"
import { isObject, type JsonObject } from "./parse.ts"
import { decodeB64 } from "./signatures.ts"
import { type JsonValue, jcsBytes, jcsCanonical } from "./vendor/sync-format/jcs.ts"

export type EpochKeys = {
  readonly epoch: number
  readonly current: Uint8Array<ArrayBuffer>
  readonly history: ReadonlyMap<number, Uint8Array<ArrayBuffer>>
}

export type WrapFailure =
  | "unverified_wrap"
  | "not_addressed_to_device"
  | "wrap_refused"
  | "malformed_envelope"
  | "envelope_mismatch"
  | "bad_history"

export type WrapOutcome = { readonly ok: true; readonly keys: EpochKeys } | { readonly ok: false; readonly reason: WrapFailure }

const parseObject = (bytes: Uint8Array, keys: ReadonlyArray<string>): JsonObject | null => {
  const textValue = new TextDecoder().decode(bytes)
  let parsed: JsonValue
  try {
    parsed = JSON.parse(textValue)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const own = Object.keys(parsed).sort()
  if (own.length !== keys.length || ![...keys].sort().every((key, index) => key === own[index])) return null
  return jcsCanonical(parsed) === textValue ? parsed : null
}

/**
 * Opens the epoch-history bundle of a wrap's key material (sync-design section 8.1):
 * AES-256-GCM under current_key with AAD JCS{account, epoch, id, version: 1}; the plaintext
 * is a canonical array of {epoch, origin, key} sorted by (epoch, origin) that must hold
 * exactly the expected non-cancelled earlier epochs - a cancelled, unknown, duplicate or
 * missing origin rejects the bundle.
 */
export const openHistory = async (
  material: JsonValue | undefined,
  binding: { readonly account: string; readonly epoch: number; readonly id: string },
  expected: ReadonlyMap<number, string>,
): Promise<{ readonly current: Uint8Array<ArrayBuffer>; readonly history: ReadonlyMap<number, Uint8Array<ArrayBuffer>> } | null> => {
  if (!isObject(material)) return null
  const history = material["history"]
  if (material["version"] !== 1 || !isObject(history)) return null
  const current = decodeB64(material["current_key"], 32)
  const nonce = decodeB64(history["nonce"], 12)
  const ciphertext = decodeB64(history["ciphertext"])
  if (current === null || nonce === null || ciphertext === null) return null
  const key = await crypto.subtle.importKey("raw", current, "AES-GCM", false, ["decrypt"])
  const additionalData = jcsBytes({ account: binding.account, epoch: binding.epoch, id: binding.id, version: 1 })
  let plain: Uint8Array<ArrayBuffer>
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 }, key, ciphertext))
  } catch {
    return null
  }
  const textValue = new TextDecoder().decode(plain)
  let rows: JsonValue
  try {
    rows = JSON.parse(textValue)
  } catch {
    return null
  }
  if (!Array.isArray(rows) || jcsCanonical(rows) !== textValue || rows.length !== expected.size) return null
  const keys = new Map<number, Uint8Array<ArrayBuffer>>()
  let previous: readonly [number, string] | null = null
  for (const row of rows) {
    if (!isObject(row)) return null
    const epoch = row["epoch"]
    const origin = row["origin"]
    const rowKey = decodeB64(row["key"], 32)
    if (typeof epoch !== "number" || typeof origin !== "string" || rowKey === null) return null
    if (expected.get(epoch) !== origin || keys.has(epoch)) return null
    if (previous !== null && (epoch < previous[0] || (epoch === previous[0] && origin <= previous[1]))) return null
    previous = [epoch, origin]
    keys.set(epoch, rowKey)
  }
  return { current, history: keys }
}

/**
 * Opens one wrap addressed to this device - only a wrap the local verified chain minted from an
 * entry that passed its wrap-set rule (never one the server attached or a caller re-shaped), and
 * only through the DeviceKeyring, which owns the sealing private key and the HPKE construction
 * (sync-design section 8.1). The verified wrap entry's account, epoch and recipient are the AEAD's
 * associated data, so a genuine ciphertext moved to another account, epoch or device fails to
 * unseal; the inner envelope must name the same three values before any key is returned.
 */
export const openWrap = async (
  keyring: DeviceKeyring,
  wrap: VerifiedWrap,
  account: string,
  expectedHistory: ReadonlyMap<number, string>,
): Promise<WrapOutcome> => {
  if (!isVerifiedWrap(wrap)) return { ok: false, reason: "unverified_wrap" }
  if (wrap.account !== account) return { ok: false, reason: "envelope_mismatch" }
  if (wrap.id !== `device:${keyring.principal().id}`) return { ok: false, reason: "not_addressed_to_device" }
  const sealed = decodeB64(wrap.wrap)
  if (sealed === null) return { ok: false, reason: "malformed_envelope" }
  let plaintext: Uint8Array
  try {
    plaintext = await keyring.unseal(sealed, { account, epoch: wrap.epoch, id: wrap.id })
  } catch {
    return { ok: false, reason: "wrap_refused" }
  }
  const envelope = parseObject(plaintext, ["version", "account", "epoch", "id", "key_material"])
  if (envelope === null || envelope["version"] !== 1) return { ok: false, reason: "malformed_envelope" }
  if (envelope["account"] !== account || envelope["epoch"] !== wrap.epoch || envelope["id"] !== wrap.id) {
    return { ok: false, reason: "envelope_mismatch" }
  }
  const opened = await openHistory(envelope["key_material"], { account, epoch: wrap.epoch, id: wrap.id }, expectedHistory)
  if (opened === null) return { ok: false, reason: "bad_history" }
  return { ok: true, keys: { epoch: wrap.epoch, current: opened.current, history: opened.history } }
}
