import type { RecoverRefusalReason, RecoverSyncOutcome } from "@oh-my-opencode/memory-core/sync-engine"
import type {
  SyncRecoverRefusal,
  SyncRecoverRequest,
  SyncRecoverResponse,
  SyncRpcProblem,
  SyncStatusResponse,
} from "./sync-rpc-contract"
import { refused, RetiredSyncOperation, serviceProblem, syncErrorFields, type Operation } from "./sync-rpc-operation"
import type {
  SyncRpcAccount,
  SyncRpcAuthority,
  SyncRpcClaim,
  SyncRpcContext,
  SyncRpcOperation,
  SyncRpcOptions,
} from "./sync-rpc-ports"

type EngineReason = RecoverRefusalReason | "pin-conflict" | "pin-corrupt"

/** One RPC answer per engine reason (D12 section 1 table); a reason added without a target fails the typecheck. */
export function recoverRefusalCode(reason: EngineReason): SyncRecoverRefusal | "cancelled" {
  switch (reason) {
    case "cancelled":
      return "cancelled"
    case "no-prf":
    case "no-user-verification":
      return "authenticator-unsupported"
    case "approval-required":
      return "surface-unavailable"
    case "bad-device":
    case "too-many-recovery-keys":
      return "refused"
    case "unavailable":
    case "rp-mismatch":
    case "too-many-attempts":
    case "phrase_keys_not_accepted":
    case "not-enrolled":
    case "history-incomplete":
    case "key-mismatch":
    case "countersign-mismatch":
    case "wrap-refused":
    case "wrap-unbound":
    case "recovery-expired":
    case "unverified":
    case "no-recovery-key":
    case "join-refused":
    case "join-unconfirmed":
    case "stale_base":
    case "rate_limited":
    case "not_found":
    case "refused":
    case "pin-conflict":
    case "pin-corrupt":
    case "already-member":
      return reason
    default: {
      const unmapped: never = reason
      return unmapped
    }
  }
}

const refusal = (code: SyncRecoverRefusal): SyncRecoverResponse => ({ kind: "recover_refused", code })

export function recoverResponse(outcome: RecoverSyncOutcome): SyncRecoverResponse {
  if (outcome.ok)
    return {
      kind: outcome.state === "recovered" ? "recovered" : "recovered_read_only",
      sync: outcome.sync,
      ...(outcome.rootChanged === true && { rootChanged: true as const }),
      ...(outcome.rootCheck !== undefined && { rootCheck: outcome.rootCheck }),
    }
  const code = recoverRefusalCode(outcome.reason)
  return code === "cancelled" ? { kind: "cancelled" } : refusal(code)
}

export interface RecoverDeps {
  readonly current: (owner: SyncRpcContext) => Promise<SyncRpcAccount>
  readonly authority: (record: Operation) => SyncRpcAuthority
  readonly subscribe: (record: Operation, signal: AbortSignal) => void
  readonly newRecord: (owner: SyncRpcContext) => Operation
  readonly disposeRecord: (record: Operation) => void
  readonly enableActive: () => boolean
}

const recoverable = (options: SyncRpcOptions, account: SyncRpcAccount | null): boolean =>
  options.runtime.recoverAccount !== undefined && account?.descriptor.phraseRecover === "supported"

/**
 * Whether `features` lists `recover`. An account source that cannot be read leaves `recover` out and
 * never fails the whole answer, so `disable`, `acknowledge` and `phrase-genesis` stay visible (#14464 L1).
 */
export const recoverFeature = async (options: SyncRpcOptions): Promise<boolean> => {
  if (options.runtime.recoverAccount === undefined) return false
  const account = await options.source().catch(() => null)
  return recoverable(options, account)
}

/**
 * The status reading of the recover entry; absent on a host without it, and absent when it cannot be read now, so
 * the desktop never shows a button the engine would refuse.
 */
export async function recoveryStatusField(
  options: SyncRpcOptions,
  account: SyncRpcAccount,
  read: <T>(use: (ports: SyncRpcOperation, account: SyncRpcAccount) => Promise<T>) => Promise<T | SyncRpcProblem>,
): Promise<Pick<Extract<SyncStatusResponse, { readonly approvals: unknown }>, "recovery">> {
  const status = options.runtime.recoveryStatus
  if (status === undefined || !recoverable(options, account)) return {}
  const reading = await read((ports, current) =>
    status({
      chain: ports.chain,
      account: current.descriptor.accountId,
      pinDir: options.pinDir,
      deviceId: current.descriptor.syncPrincipalId,
    }),
  )
  return reading === null || "kind" in reading ? {} : { recovery: reading }
}

/**
 * `omo.memory.sync.recover` (D12): the ceremony claim is the one enable takes, so a second recover or an enable on this
 * device answers in_progress. Desktop main runs the words window and holds the keys; this side moves only public
 * values. A recovery that turned sync on resumes the parked engines, as enable does.
 */
export async function runRecover(
  options: SyncRpcOptions,
  deps: RecoverDeps,
  owner: SyncRpcContext,
  request: SyncRecoverRequest,
): Promise<SyncRecoverResponse> {
  const recoverAccount = options.runtime.recoverAccount
  if (recoverAccount === undefined) return refusal("surface-unavailable")
  if (deps.enableActive()) return { kind: "in_progress" }
  const record = deps.newRecord(owner)
  let ports: SyncRpcOperation | undefined
  let claim: SyncRpcClaim | undefined
  let resume = false
  try {
    const account = await deps.current(owner)
    record.account = account
    deps.subscribe(record, account.signal)
    const auth = deps.authority(record)
    auth.admit(() => undefined)
    if (!recoverable(options, account)) return refusal("surface-unavailable")
    const acquired = await options.claims.acquire(account.descriptor, "enable", undefined, auth)
    if (acquired === null) return { kind: "in_progress" }
    claim = acquired
    ports = await account.forOperation(auth)
    auth.admit(() => undefined)
    const captured = account.descriptor
    const keys = ports.keyring.publicKeys()
    if (
      ports.keyring.principal().id !== captured.syncPrincipalId ||
      keys.signing !== captured.publicKeys.signing ||
      keys.sealing !== captured.publicKeys.sealing
    )
      throw new RetiredSyncOperation()
    const bridge = ports.recovery?.((code) =>
      options.warn?.("memory sync recover bridge reply invalid", { path: "recover", code }),
    )
    if (bridge === undefined) return refusal("surface-unavailable")
    const outcome = await recoverAccount({
      account: captured.accountId,
      serviceDeviceId: captured.serviceDeviceId,
      rpId: captured.rpId ?? "",
      keyring: ports.keyring,
      chain: ports.chain,
      pairing: ports.pairing,
      pinDir: options.pinDir,
      authority: auth,
      signal: auth.signal,
      bridge,
      method: request.method,
      onSwitchFailed: (error) =>
        options.warn?.("memory sync recover left sync off", {
          path: "recover",
          code: "switch_failed",
          ...syncErrorFields(error),
        }),
    })
    auth.admit(() => undefined)
    const response = recoverResponse(outcome)
    resume = "sync" in response && response.sync === "on"
    return response
  } catch (error) {
    const problem = record.controller.signal.aborted ? refused() : serviceProblem(error)
    if (problem.kind === "unavailable")
      options.warn?.("memory sync recover unavailable", {
        path: "recover",
        code: problem.code,
        ...syncErrorFields(error),
      })
    return problem
  } finally {
    try {
      await ports?.close()
    } finally {
      try {
        await claim?.release()
      } finally {
        deps.disposeRecord(record)
      }
    }
    if (resume) await options.resumeSync?.()
  }
}
