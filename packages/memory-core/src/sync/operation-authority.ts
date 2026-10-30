/** Captured caller authority; account identity remains enforced by the selected account ports. */
export interface SyncOperationAuthority {
  readonly signal: AbortSignal
  /** Immediately invoke the effect, or throw if its captured owner has retired. */
  readonly admit: <T>(dispatch: () => T) => T
  /** Hold the credential-writer lock through a generation check and synchronous raw dispatch. */
  readonly boundary?: <T>(dispatch: () => T) => Promise<T>
}

export interface SyncOperationOptions {
  readonly signal?: AbortSignal
  readonly authority?: SyncOperationAuthority
}

export function admitSyncOperation<T>(options: SyncOperationOptions, dispatch: () => T): T {
  options.signal?.throwIfAborted()
  const authority = options.authority
  if (authority === undefined) return dispatch()
  authority.signal.throwIfAborted()
  return authority.admit(dispatch)
}

export function checkSyncOperation(options: SyncOperationOptions): void {
  admitSyncOperation(options, () => undefined)
}

export function syncOperationSignal(options: SyncOperationOptions): AbortSignal | undefined {
  const signals = [options.signal, options.authority?.signal].filter((signal): signal is AbortSignal => signal !== undefined)
  return signals.length === 0 ? undefined : AbortSignal.any(signals)
}

export function isSyncOperationCancelled(options: SyncOperationOptions, error: unknown): boolean {
  return options.signal?.aborted === true || options.authority?.signal.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
}

/** Wait cancellation does not undo an already-admitted sign, append or publication. */
export function waitSyncOperation<T>(options: SyncOperationOptions, pending: Promise<T>): Promise<T> {
  const signal = syncOperationSignal(options)
  if (signal === undefined) return pending
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    pending.then(
      value => {
        cleanup()
        try { resolve(admitSyncOperation(options, () => value)) } catch (error) { reject(error) }
      },
      error => { cleanup(); reject(error) },
    )
  })
}
