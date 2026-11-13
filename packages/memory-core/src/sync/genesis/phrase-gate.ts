import type { AccountHttp } from "../account/http.ts"

/** The service's account-scoped client floor (sisyphuslabs/omo-service#1069/#1070) as this device reads it. */
export type ServiceFloor = "on" | "off" | "unknown"

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

/** `GET /v1/sync/state` `phrase_client_floor`: true is on; false or absent (an older service) is off; an error is unknown. */
export const readServiceFloor = async (chain: AccountHttp): Promise<ServiceFloor> => {
  try {
    const state = await chain.state()
    if (state === null) return "unknown"
    return state.phraseClientFloor ? "on" : "off"
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
    return answer === "on" || answer === "off" ? answer : "unknown"
  } catch {
    return "unknown"
  } finally {
    clearTimeout(timer)
  }
}

/** Fail-closed: no gate, the flag off, or a floor that is not positively "on" all refuse creation. */
export const phraseCreationRefusal = async (
  gate: PhraseGate | undefined,
  account: string,
  chain: AccountHttp,
): Promise<PhraseGateRefusal | null> => {
  if (gate?.enabled !== true) return "disabled"
  if ((await floorOf(gate, chain)) === "on") return null
  gate.refused("service-floor-off", account)
  return "service-floor-off"
}
