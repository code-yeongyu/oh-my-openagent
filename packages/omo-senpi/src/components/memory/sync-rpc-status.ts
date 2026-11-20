import type { ApprovalProgress, SyncRpcProblem, SyncStatusResponse, SyncUnavailableCode } from "./sync-rpc-contract"
import { identityOf, RetiredSyncOperation, syncErrorFields, type Operation } from "./sync-rpc-operation"
import type { SyncRpcAccount, SyncRpcContext, SyncRpcOperation, SyncRpcOptions } from "./sync-rpc-ports"
import { recoveryStatusField } from "./sync-rpc-recover"

type Read = <T>(
  owner: SyncRpcContext,
  use: (ports: SyncRpcOperation, account: SyncRpcAccount) => Promise<T>,
) => Promise<T | SyncRpcProblem>

/** What the status read needs from the coordinator: its account check, its own ceremony records and its read path. */
export interface SyncStatusDeps {
  readonly options: SyncRpcOptions
  readonly binding: AbortSignal
  readonly current: (owner: SyncRpcContext) => Promise<SyncRpcAccount>
  readonly check: (owner: SyncRpcContext) => void
  readonly visible: (owner: SyncRpcContext, identity: ReturnType<typeof identityOf>) => readonly Operation[]
  readonly read: Read
  readonly reportUnavailable: (code: SyncUnavailableCode, fields?: Record<string, unknown>) => SyncRpcProblem
  readonly recovered: () => void
}

// A notice that cannot be read is reported as unresolved: never as void, never as saved.
const phraseNotice = async (options: SyncRpcOptions, account: SyncRpcAccount) => {
  const read = options.runtime.phraseNoticeStatus
  if (read === undefined) return {}
  try {
    return await read({
      pinDir: options.pinDir,
      account: account.descriptor.accountId,
      principalId: account.descriptor.syncPrincipalId,
    })
  } catch {
    return { phraseUnresolved: true } as const
  }
}

/** `omo.memory.sync.status`: the device's sync state, this connection's ceremonies, the phrase notices and the recover entry. */
export async function readSyncStatus(deps: SyncStatusDeps, owner: SyncRpcContext): Promise<SyncStatusResponse> {
  const { options, check } = deps
  let step: "account" | "identity" | "sync_status" | "recheck" = "account"
  try {
    const account = await deps.current(owner)
    step = "identity"
    const identity = identityOf(account)
    step = "sync_status"
    const sync = await options.syncStatus()
    step = "recheck"
    check(owner)
    deps.binding.throwIfAborted()
    if (account.signal.aborted || !(await account.isCurrent()))
      return deps.reportUnavailable("account_not_current", { step })
    check(owner)
    deps.recovered()
    const visible = deps.visible(owner, identity)
    let notice = await phraseNotice(options, account)
    check(owner)
    // Review LOW (#13336 @ 9f9734a8): an unresolved local read may be an enroll/rotate void notice; resolve it
    // against the verified chain so the notice can show over RPC.
    const verify = options.runtime.verifiedPhraseNoticeStatus
    if (notice.phraseUnresolved === true && verify !== undefined) {
      const verified = await deps.read(owner, (ports, current) =>
        verify({
          pinDir: options.pinDir,
          account: current.descriptor.accountId,
          principalId: current.descriptor.syncPrincipalId,
          chain: ports.chain,
        }),
      )
      if (!("kind" in verified)) notice = verified
      check(owner)
    }
    const ownEnable = visible.find((record) => record.kind === "enable")?.enable ?? null
    const recovery = await recoveryStatusField(options, account, (use) => deps.read(owner, use))
    check(owner)
    return {
      ...(sync === undefined ? {} : { sync }),
      ...recovery,
      // Another process (the CLI) holding the ceremony shows as in progress, never as a void phrase.
      enable: ownEnable ?? (notice.inProgress === true ? { kind: "in_progress" } : null),
      ...(notice.phraseVoid !== undefined ? { phraseVoid: notice.phraseVoid } : {}),
      ...(notice.phraseUnresolved === true ? { phraseUnresolved: true } : {}),
      approvals: visible
        .filter((record) => record.kind === "approve" && record.expiresAt !== undefined)
        .map((record): ApprovalProgress => ({
          pendingId: record.pendingId ?? "",
          expiresAt: record.expiresAt ?? 0,
          code: record.code,
          outcome: record.approval,
        })),
    }
  } catch (error) {
    return deps.reportUnavailable(error instanceof RetiredSyncOperation ? error.code : "status_read_failed", {
      step,
      ...syncErrorFields(error),
    })
  }
}
