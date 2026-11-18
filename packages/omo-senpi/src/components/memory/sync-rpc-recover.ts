import type { RecoverOutcome } from "@oh-my-opencode/memory-core/sync-recovery"
import type { SyncRecoverResponse } from "./sync-rpc-contract"

type Refused = Extract<SyncRecoverResponse, { kind: "recover_refused" }>["reason"]

const REFUSALS: Readonly<Record<string, Refused>> = {
  cancelled: "cancelled",
  "no-recovery-key": "no-recovery-key",
  "history-incomplete": "history-incomplete",
  unavailable: "unavailable",
}

export function recoverResponse(outcome: RecoverOutcome): SyncRecoverResponse {
  if (outcome.ok) return outcome.state === "recovered" ? { kind: "recovered" } : { kind: "recovered_read_only" }
  return { kind: "recover_refused", reason: REFUSALS[outcome.reason] ?? "refused" }
}
