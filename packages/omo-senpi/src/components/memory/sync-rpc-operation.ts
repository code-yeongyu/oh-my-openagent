import type { ApproveOutcome } from "@oh-my-opencode/memory-core/sync-engine"
import type { SyncEnableResponse, SyncRpcProblem } from "./sync-rpc-contract"
import type { SyncRpcAccount, SyncRpcAuthority, SyncRpcClaim, SyncRpcContext, SyncRpcOperation, SyncRpcOptions } from "./sync-rpc-ports"

export const unavailable = (): SyncRpcProblem => ({ kind: "unavailable", reason: "Memory sync authority is unavailable." })
export const refused = (): SyncRpcProblem => ({ kind: "refused", reason: "This sync operation is no longer available to this connection." })
export function serviceProblem(error: unknown): SyncRpcProblem {
  return error instanceof Error && error.name === "AccountHttpError" && "status" in error
    && typeof error.status === "number" && error.status >= 400 && error.status < 500
    ? { kind: "refused", reason: "The service refused this sync request." }
    : unavailable()
}

export class RetiredSyncOperation extends Error {}

/** A record that runs a ceremony and takes a claim; a "read" record never does. */
export type CeremonyOperation = Operation & { readonly kind: "enable" | "approve" }

export interface Operation {
  readonly kind: "enable" | "approve" | "read"
  readonly owner: SyncRpcContext
  readonly controller: AbortController
  readonly ready: PromiseWithResolvers<void>
  readonly confirmation: PromiseWithResolvers<boolean>
  readonly pendingId: string | undefined
  readonly disposeListeners: (() => void)[]
  account: SyncRpcAccount | undefined
  identity: string | undefined
  active: boolean
  expired: boolean
  expiresAt: number | undefined
  code: string | null
  confirmed: boolean
  enable: SyncEnableResponse | null
  approval: ApproveOutcome | null
  problem: SyncRpcProblem | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  done: Promise<void>
}

export function identityOf(account: SyncRpcAccount): string {
  const d = account.descriptor
  return JSON.stringify([d.serviceOrigin, d.accountId, d.serviceDeviceId, d.syncPrincipalId, d.publicKeys.signing, d.publicKeys.sealing, d.generation, d.incarnation])
}

export async function runSyncRpcOperation(
  record: CeremonyOperation,
  options: SyncRpcOptions,
  deps: {
    readonly current: (owner: SyncRpcContext) => Promise<SyncRpcAccount>
    readonly authority: (record: Operation) => SyncRpcAuthority
    readonly subscribe: (record: Operation, signal: AbortSignal) => void
    readonly cancel: (record: Operation) => void
  },
): Promise<void> {
  const { current, authority, subscribe, cancel } = deps
  const now = options.clock?.now ?? Date.now
  let ports: SyncRpcOperation | undefined
  let claim: SyncRpcClaim | undefined
  let observed: Promise<void> = Promise.resolve()
  try {
    record.account = await current(record.owner)
    record.identity = identityOf(record.account)
    subscribe(record, record.account.signal)
    const auth = authority(record)
    auth.admit(() => undefined)
    const acquired = await options.claims.acquire(record.account.descriptor, record.kind, record.pendingId, auth)
    if (acquired === null) {
      record.enable = refused()
      record.problem = refused()
      record.approval = { kind: "refused", reason: "Another connection is already running this ceremony." }
      return
    }
    claim = acquired
    auth.admit(() => undefined)
    ports = await record.account.forOperation(auth)
    auth.admit(() => undefined)
    const captured = record.account.descriptor
    const keys = ports.keyring.publicKeys()
    if (ports.keyring.principal().id !== captured.syncPrincipalId
      || keys.signing !== captured.publicKeys.signing || keys.sealing !== captured.publicKeys.sealing) {
      throw new RetiredSyncOperation()
    }
    const input = {
      account: record.account.descriptor.accountId, serviceDeviceId: record.account.descriptor.serviceDeviceId,
      serviceOrigin: captured.serviceOrigin,
      ...(captured.genesis === "supported" && captured.rpId !== null && captured.userName !== null
        ? { rpId: captured.rpId, userName: captured.userName } : {}),
      ...(captured.genesis === "supported" && ports.genesis !== undefined ? { genesis: ports.genesis } : {}),
      keyring: ports.keyring, chain: ports.chain, pairing: ports.pairing,
      pinDir: options.pinDir, authority: auth, signal: auth.signal,
    }
    const observe = (row: { readonly id: string; readonly expires_at: number }): void => {
      auth.admit(() => undefined)
      if (record.kind === "approve" && row.id !== record.pendingId) throw new RetiredSyncOperation()
      record.expiresAt = row.expires_at
      if (row.expires_at <= now()) {
        record.expired = true
        cancel(record)
        return
      }
      const expire = (): void => {
        const remaining = row.expires_at - now()
        if (remaining <= 0) { record.expired = true; cancel(record); return }
        record.timer = setTimeout(expire, Math.min(remaining, 2_147_483_647))
        record.timer.unref?.()
      }
      expire()
      if (record.kind === "enable") record.enable = { kind: "join_required", pairing: { pendingId: row.id, expiresAt: row.expires_at, code: null } }
      observed = acquired.expiresAt(row.expires_at).then(
        () => { auth.admit(() => undefined); record.ready.resolve() },
      ).catch(() => cancel(record))
    }
    const clock = {
      now,
      sleep: (ms: number) => new Promise<void>((resolve, reject) => {
        auth.signal.throwIfAborted()
        let timer: ReturnType<typeof setTimeout> | undefined
        const onAbort = () => { if (timer !== undefined) clearTimeout(timer); reject(new RetiredSyncOperation()) }
        auth.signal.addEventListener("abort", onAbort, { once: true })
        const finish = () => { auth.signal.removeEventListener("abort", onAbort); resolve() }
        if (options.clock === undefined) timer = setTimeout(finish, ms)
        else void options.clock.sleep(ms).then(finish, (error: unknown) => { auth.signal.removeEventListener("abort", onAbort); reject(error) })
      }),
    }
    if (record.kind === "enable") {
      const result = await options.runtime.enableSync(input)
      auth.admit(() => undefined)
      switch (result.kind) {
        case "joined": record.enable = { kind: result.created === true ? "first_device_created" : "joined" }; break
        case "needs_first_device": record.enable = result; break
        case "join_required":
          record.enable = await options.runtime.joinAccount({
            ...input, clock,
            onPending: observe,
            showCode: (code) => {
              auth.admit(() => undefined)
              if (!/^[0-9]{6}$/.test(code)) throw new RetiredSyncOperation()
              const previous = record.enable
              if (previous?.kind === "join_required") record.enable = { ...previous, pairing: { ...previous.pairing, code } }
            },
          })
          auth.admit(() => undefined)
          break
      }
    } else {
      record.approval = await options.runtime.approveDevice({
        ...input, clock, pendingId: record.pendingId ?? "",
        onAnswered: observe,
        confirmCode: (code) => {
          auth.admit(() => undefined)
          if (!/^[0-9]{6}$/.test(code)) throw new RetiredSyncOperation()
          record.code = code
          return record.confirmation.promise
        },
      })
      auth.admit(() => undefined)
    }
  } catch (error) {
    // RPC boundary: neither exceptions nor service-supplied strings reach clients.
    record.enable = record.controller.signal.aborted ? (record.expired ? { kind: "expired" } : refused()) : serviceProblem(error)
    record.problem = record.controller.signal.aborted ? refused() : serviceProblem(error)
    record.approval = record.expired ? { kind: "expired" } : { kind: "refused", reason: error instanceof RetiredSyncOperation ? "The sync operation ended." : "The sync service could not complete this operation." }
  } finally {
    record.code = null
    if (record.enable?.kind === "join_required") record.enable = record.controller.signal.aborted ? refused() : record.enable
    await observed
    try { await ports?.close() } catch {
      record.enable = unavailable()
      record.approval = { kind: "refused", reason: "The sync operation could not be closed." }
    } finally {
      try { await claim?.release() } catch {
        record.enable = unavailable()
        record.approval = { kind: "refused", reason: "The sync claim could not be released." }
      } finally {
        record.active = false
        record.ready.resolve()
        if (record.timer !== undefined) clearTimeout(record.timer)
      }
    }
  }
}
