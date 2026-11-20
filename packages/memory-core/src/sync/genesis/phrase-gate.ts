import type { AccountHttp } from "../account/http.ts"

/**
 * A device the service names as blocking phrase keys for this account (per-account phrase gate): it synced recently
 * without declaring the phrase capability, so it must update first. Labels only, never ids.
 */
export interface PhraseKeyBlocker {
  readonly label: string
  readonly kind: string
  readonly platform: string
  readonly lastSyncAt: string
}

/**
 * The service's account-scoped client floor (sisyphuslabs/omo-service#1069/#1070) as this device reads it; an object
 * is an off floor whose cause is named devices that must update first (#1189).
 */
export type ServiceFloor = "on" | "off" | "unknown" | { readonly blockedBy: ReadonlyArray<PhraseKeyBlocker> }

/** A `phrase_keys_not_accepted` refusal's `error.detail` (per-account phrase gate): the devices to update first, else none. */
export const refusalBlockersOf = (code: string, detail: unknown): ReadonlyArray<PhraseKeyBlocker> =>
  code === "phrase_keys_not_accepted" &&
  typeof detail === "object" &&
  detail !== null &&
  (detail as Record<string, unknown>)["reason"] === "devices_need_update"
    ? phraseKeyBlockersOf((detail as Record<string, unknown>)["devices"])
    : []

/** Why phrase creation was refused, with the devices to update when the service named them. */
export interface PhraseRefusal {
  readonly reason: PhraseGateRefusal
  readonly devices?: ReadonlyArray<PhraseKeyBlocker>
}

const blockerOf = (value: unknown): PhraseKeyBlocker | null => {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  const label = row["label"]
  if (typeof label !== "string" || label.length === 0) return null
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : "")
  return {
    label,
    kind: text("kind"),
    platform: text("platform"),
    lastSyncAt: text("lastSyncAt") || text("last_sync_at"),
  }
}

/** An open decoder over the service's blocker list: malformed rows are dropped, anything but an array is none. */
export const phraseKeyBlockersOf = (value: unknown): ReadonlyArray<PhraseKeyBlocker> =>
  Array.isArray(value) ? value.map(blockerOf).filter((row): row is PhraseKeyBlocker => row !== null) : []

/**
 * The client-side release gate for creating a recovery-phrase key (contract amendment A1). `enabled` is
 * the engine flag, off by default; it may be turned on only after the service floor refuses older
 * clients, and the floor is re-read on every creation. `refused` is the loud log line a refused creation
 * writes; it receives a reason and the account id, never a secret. `serviceFloor` is injected only by
 * tests and, once the A1 delta conditions hold, by the host with `readServiceFloor`; absent, the floor is unknown.
 */
export interface PhraseGate {
  readonly enabled: boolean
  readonly serviceFloor?: (chain: AccountHttp) => Promise<ServiceFloor>
  /** How long a floor read may take before it counts as unknown; tests shorten it. */
  readonly floorTimeoutMs?: number
  refused(reason: PhraseGateRefusal, account: string): void
}

const FLOOR_TIMEOUT_MS = 10_000

export type PhraseGateRefusal = "disabled" | "service-floor-off"

/** `GET /v1/sync/state` `accepts_phrase_keys`: true is on; false or absent (an older service) is off; an error is unknown. */
export const readServiceFloor = async (chain: AccountHttp): Promise<ServiceFloor> => {
  try {
    const state = await chain.state()
    if (state === null) return "unknown"
    if (state.acceptsPhraseKeys) return "on"
    return state.phraseKeyBlockers.length > 0 ? { blockedBy: state.phraseKeyBlockers } : "off"
  } catch {
    return "unknown"
  }
}

/**
 * One fresh floor read per ceremony, never cached (A1.1-M4). A port that throws, rejects, outlasts its
 * timeout or answers anything but "on" | "off" | "unknown" reads as unknown. With no port the answer is
 * unknown: production wires `readServiceFloor` only after the A1 delta conditions hold.
 */
const floorOf = async (gate: PhraseGate, chain: AccountHttp): Promise<ServiceFloor> => {
  const port = gate.serviceFloor
  if (port === undefined) return "unknown"
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ServiceFloor>((resolve) => {
    timer = setTimeout(() => resolve("unknown"), gate.floorTimeoutMs ?? FLOOR_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    const answer: unknown = await Promise.race([Promise.resolve().then(() => port(chain)), timeout])
    if (answer === "on" || answer === "off") return answer
    if (typeof answer === "object" && answer !== null && "blockedBy" in answer) {
      const devices = phraseKeyBlockersOf(answer.blockedBy)
      return devices.length > 0 ? { blockedBy: devices } : "off"
    }
    return "unknown"
  } catch {
    return "unknown"
  } finally {
    clearTimeout(timer)
  }
}

/** Fail-closed: no gate, a disabled gate, or a floor that is not positively "on" all refuse creation. */
export const phraseCreationRefusal = async (
  gate: PhraseGate | undefined,
  account: string,
  chain: AccountHttp,
): Promise<PhraseRefusal | null> => {
  if (gate?.enabled !== true) return { reason: "disabled" }
  const floor = await floorOf(gate, chain)
  if (floor === "on") return null
  gate.refused("service-floor-off", account)
  return typeof floor === "object"
    ? { reason: "service-floor-off", devices: floor.blockedBy }
    : { reason: "service-floor-off" }
}
