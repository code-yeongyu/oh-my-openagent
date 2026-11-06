import type { ApprovalProgress, SyncApproveRequest, SyncApproveResponse, SyncEnableResponse, SyncRpcProblem, SyncStatusResponse } from "./sync-rpc-contract"
import type { SyncRpcAccount, SyncRpcAuthority, SyncRpcContext, SyncRpcOperation, SyncRpcOptions } from "./sync-rpc-ports"
import { identityOf, refused, RetiredSyncOperation, runSyncRpcOperation, serviceProblem, unavailable, type CeremonyOperation, type Operation } from "./sync-rpc-operation"

export function createSyncRpcCoordinator(options: SyncRpcOptions) {
  let lifetime = new AbortController()
  let enable: Operation | undefined
  const approvals = new Map<string, Operation>()
  const operations = new Set<Operation>()
  const reads = new Set<Promise<unknown>>()

  const check = (context: SyncRpcContext): void => {
    lifetime.signal.throwIfAborted()
    options.signal.throwIfAborted()
    context.disconnectSignal.throwIfAborted()
    context.admit(() => undefined)
  }
  const records = () => [...(enable === undefined ? [] : [enable]), ...approvals.values()]
  const cancel = (record: Operation): void => {
    record.controller.abort(new RetiredSyncOperation())
    record.code = null
    record.confirmation.resolve(false)
    record.enable = record.expired ? { kind: "expired" } : refused()
    record.approval = record.expired ? { kind: "expired" } : { kind: "refused", reason: "The sync operation ended." }
    record.ready.resolve()
    if (record.timer !== undefined) clearTimeout(record.timer)
  }
  const subscribe = (record: Operation, signal: AbortSignal): void => {
    const listener = () => { record.expired = false; cancel(record) }
    signal.addEventListener("abort", listener, { once: true })
    record.disposeListeners.push(() => signal.removeEventListener("abort", listener))
    if (signal.aborted) listener()
  }
  const current = async (context: SyncRpcContext): Promise<SyncRpcAccount> => {
    check(context)
    const account = await options.source()
    check(context)
    if (account === null || account.signal.aborted || !(await account.isCurrent())) throw new RetiredSyncOperation()
    check(context)
    if (account.signal.aborted) throw new RetiredSyncOperation()
    return account
  }
  const authority = (record: Operation): SyncRpcAuthority => ({
    signal: record.controller.signal,
    admit: (dispatch) => {
      record.controller.signal.throwIfAborted()
      record.account?.signal.throwIfAborted()
      check(record.owner)
      return record.owner.admit(dispatch)
    },
    boundary: async (dispatch) => {
      const account = record.account
      if (account === undefined) {
        cancel(record)
        throw new RetiredSyncOperation()
      }
      return account.boundary(() => authority(record).admit(dispatch))
    },
  })
  const newRecord = <K extends Operation["kind"]>(owner: SyncRpcContext, kind: K, pendingId?: string): Operation & { readonly kind: K } => {
    const record: Operation & { readonly kind: K } = {
      kind, owner, pendingId, controller: new AbortController(),
      ready: Promise.withResolvers<void>(), confirmation: Promise.withResolvers<boolean>(),
      disposeListeners: [], account: undefined, identity: undefined, active: true,
      expired: false, expiresAt: undefined, code: null, confirmed: false,
      enable: null, approval: null, problem: undefined, timer: undefined, done: Promise.resolve(),
    }
    subscribe(record, owner.disconnectSignal)
    subscribe(record, options.signal)
    subscribe(record, lifetime.signal)
    return record
  }
  const disposeRecord = (record: Operation): void => {
    if (record.timer !== undefined) clearTimeout(record.timer)
    for (const dispose of record.disposeListeners.splice(0)) dispose()
  }
  const progress = (record: Operation): SyncApproveResponse => record.expiresAt === undefined
    ? record.problem ?? refused()
    : { pendingId: record.pendingId ?? "", expiresAt: record.expiresAt, code: record.code, outcome: record.approval }
  const readEnable = (record: Operation): SyncEnableResponse => record.enable ?? unavailable()

  const start = (record: CeremonyOperation): void => {
    operations.add(record)
    record.done = runSyncRpcOperation(record, options, { current, authority, subscribe, cancel })
      .finally(() => operations.delete(record))
  }
  // Only ownerId is compared here. A reconnect that reuses an ownerId is a new connection incarnation, and it is
  // fenced indirectly: the old connection's disconnect aborts the record's controller (so the check below fails),
  // and identityOf keys every operation by the account descriptor's incarnation.
  const ensureOwned = (record: Operation, owner: SyncRpcContext): boolean => record.owner.ownerId === owner.ownerId
    && (!record.controller.signal.aborted || record.expired)
  const currentRecord = async (record: Operation, owner: SyncRpcContext): Promise<boolean> => {
    if (!ensureOwned(record, owner)) return false
    if (record.account !== undefined && (record.account.signal.aborted || !(await record.account.isCurrent()))) {
      record.expired = false
      cancel(record)
      return false
    }
    check(owner)
    return ensureOwned(record, owner)
  }

  return {
    check(context: SyncRpcContext | undefined): context is SyncRpcContext {
      if (context === undefined) return false
      try { check(context); return true } catch { return false }
    },
    async enable(owner: SyncRpcContext): Promise<SyncEnableResponse> {
      if (enable?.active) {
        if (!ensureOwned(enable, owner)) return refused()
        const record = enable
        await record.ready.promise
        return await currentRecord(record, owner) ? readEnable(record) : refused()
      }
      if (enable !== undefined) disposeRecord(enable)
      const record = newRecord(owner, "enable")
      enable = record
      start(record)
      await record.ready.promise
      return readEnable(record)
    },
    async approve(owner: SyncRpcContext, request: SyncApproveRequest): Promise<SyncApproveResponse> {
      const previous = approvals.get(request.pendingId)
      const wasActive = previous?.active === true
      if (previous !== undefined && !ensureOwned(previous, owner)) return refused()
      if (previous !== undefined && !(await currentRecord(previous, owner))) return refused()
      if (request.action === "begin") {
        if (previous !== undefined && wasActive) { await previous.ready.promise; return progress(previous) }
        if (previous !== undefined) disposeRecord(previous)
        const record = newRecord(owner, "approve", request.pendingId)
        approvals.set(request.pendingId, record)
        start(record)
        await record.ready.promise
        return progress(record)
      }
      if (previous === undefined) return refused()
      if (!previous.active) return progress(previous)
      if (request.action === "confirm" && previous.code === null) return refused()
      if (!previous.confirmed) {
        previous.confirmed = true
        previous.confirmation.resolve(request.action === "confirm" && request.code === previous.code)
      }
      await previous.done
      return progress(previous)
    },
    async status(owner: SyncRpcContext): Promise<SyncStatusResponse> {
      const binding = lifetime.signal
      try {
        const account = await current(owner)
        const identity = identityOf(account)
        const sync = await options.syncStatus()
        check(owner)
        binding.throwIfAborted()
        if (account.signal.aborted || !(await account.isCurrent())) return unavailable()
        check(owner)
        const visible = records().filter((record) => ensureOwned(record, owner) && record.identity === identity)
        return {
          ...(sync === undefined ? {} : { sync }),
          enable: visible.find((record) => record.kind === "enable")?.enable ?? null,
          approvals: visible.filter((record) => record.kind === "approve" && record.expiresAt !== undefined).map((record): ApprovalProgress => ({
            pendingId: record.pendingId ?? "", expiresAt: record.expiresAt ?? 0, code: record.code, outcome: record.approval,
          })),
        }
      } catch { return unavailable() }
    },
    async read<T>(owner: SyncRpcContext, use: (ports: SyncRpcOperation) => Promise<T>): Promise<T | SyncRpcProblem> {
      const record = newRecord(owner, "read")
      const task = (async () => {
        let ports: SyncRpcOperation | undefined
        try {
          record.account = await current(owner)
          subscribe(record, record.account.signal)
          const auth = authority(record)
          auth.admit(() => undefined)
          ports = await record.account.forOperation(auth)
          auth.admit(() => undefined)
          const result = await use(ports)
          auth.admit(() => undefined)
          if (!(await record.account.isCurrent())) return unavailable()
          auth.admit(() => undefined)
          return result
        } catch (error) { return serviceProblem(error) } finally { try { await ports?.close() } finally { disposeRecord(record) } }
      })()
      reads.add(task)
      try { return await task } finally { reads.delete(task) }
    },
    async dispose(): Promise<void> {
      lifetime.abort()
      await Promise.all([...operations].map((record) => record.done))
      await Promise.all(reads)
      for (const record of records()) disposeRecord(record)
      enable = undefined
      approvals.clear()
    },
    retireBinding(): void {
      lifetime.abort()
      for (const record of records()) disposeRecord(record)
      enable = undefined
      approvals.clear()
      lifetime = new AbortController()
    },
  }
}
