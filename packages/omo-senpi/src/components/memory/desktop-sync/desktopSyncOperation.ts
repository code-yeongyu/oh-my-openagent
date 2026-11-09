import {
  decodeSyncHandle,
  DesktopSyncRefused,
  type DesktopSyncAuthority,
  type DesktopSyncRequest,
  type DesktopSyncWire,
} from "./desktopSyncProtocol"

type OperationRequest = { readonly op: "service" | "keyring" | "genesisRun"; readonly data: unknown }

export interface DesktopSyncOperationHandle {
  readonly handle: string
  request(request: OperationRequest): Promise<unknown>
  close(): Promise<void>
}

/** The owner fence encloses the immediate authenticated write, not an async preparation. */
export async function openDesktopSyncOperation(wire: DesktopSyncWire, authority: DesktopSyncAuthority): Promise<DesktopSyncOperationHandle> {
  let handle: string | undefined
  let cancelled = authority.signal.aborted
  let ended = false
  let cancelling: Promise<unknown> | undefined
  const cancel = () => {
    cancelled = true
    if (handle !== undefined && cancelling === undefined) {
      cancelling = wire.request({ op: "operationCancel", handle })
      // Keep the rejection observed even while begin is still suspended.
      void cancelling.catch(() => undefined)
    }
  }
  authority.signal.addEventListener("abort", cancel, { once: true })
  const close = async () => {
    if (ended) return
    ended = true
    authority.signal.removeEventListener("abort", cancel)
    if (handle !== undefined) {
      try {
        await cancelling
      } finally {
        await wire.request({ op: "operationEnd", handle })
      }
    }
  }
  try {
    if (cancelled) throw new DesktopSyncRefused()
    const reply = await authority.admit(() => wire.request({ op: "operationBegin" }))
    handle = decodeSyncHandle(reply).handle
    if (cancelled || authority.signal.aborted) {
      cancel()
      await close()
      throw new DesktopSyncRefused()
    }
    try {
      authority.admit(() => undefined)
    } catch (error) {
      cancel()
      await close()
      throw error
    }
    const operationHandle = handle
    return {
      handle: operationHandle,
      async request(request) {
        if (ended || cancelled) throw new DesktopSyncRefused()
        const sent: DesktopSyncRequest = { ...request, handle: operationHandle }
        const result = await authority.admit(() => wire.request(sent))
        authority.admit(() => undefined)
        if (ended || cancelled) throw new DesktopSyncRefused()
        return result
      },
      close,
    }
  } catch (error) {
    authority.signal.removeEventListener("abort", cancel)
    throw error
  }
}
