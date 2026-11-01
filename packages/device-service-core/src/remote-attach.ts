import type { LocalApiClient } from "./local-api/client.ts"
import type { ReadPage } from "./local-api/client-assembly.ts"
import { LocalApiError } from "./local-api/errors.ts"
import type { AttachPendingReason, DetachReason, JsonObject, LocalEvent, SnapshotBody } from "./local-api/protocol.ts"

/** How an attach ended: a service-reported reason, the connection closing, or this client's own detach. */
export type AttachEnd = DetachReason | "closed" | "detached" | "listener_failed"

export type RemoteAttachEvent =
  | { readonly kind: "pending"; readonly reason: AttachPendingReason }
  | { readonly kind: "snapshot"; readonly snapshot: SnapshotBody }
  | { readonly kind: "records"; readonly attach_id: number; readonly records: readonly JsonObject[] }
  | { readonly kind: "detached"; readonly reason: DetachReason }

export type RemoteAttach = {
  readonly device: string
  readonly sessionId: string
  /** The local handle the service gave this attach (owned by this connection). */
  readonly handle: string
  /** The first snapshot, inline or reassembled from its blob; a later re-attach replaces it through `onEvent`. */
  readonly snapshot: Promise<SnapshotBody>
  /** Settles with the reason once the attach ends, whoever ended it. */
  readonly detached: Promise<AttachEnd>
  /** Every event of this attach in order, replayed from the latest snapshot for a listener added later. */
  readonly onEvent: (listener: (event: RemoteAttachEvent) => void) => () => void
  /** One page of older history; entries too large to fetch are marked `too_large`. */
  readonly read: (options?: { readonly before?: string; readonly tail?: number }) => Promise<ReadPage>
  /** Detaches; afterwards this attach holds no subscription on the connection and `detached` settles "detached". */
  readonly detach: () => Promise<void>
  /** The error a listener threw, which ended the attach with "listener_failed"; undefined otherwise. */
  readonly failure: () => unknown
}

type AttachEvent = Extract<
  LocalEvent,
  { readonly kind: "session.snapshot" | "session.records" | "session.attach_pending" | "session.detached" }
>

const attachEvent = (event: LocalEvent): AttachEvent | undefined => {
  switch (event.kind) {
    case "session.snapshot":
    case "session.records":
    case "session.attach_pending":
    case "session.detached":
      return event
    default:
      return undefined
  }
}

const toRemote = (event: AttachEvent): RemoteAttachEvent => {
  switch (event.kind) {
    case "session.snapshot": {
      const { type: _type, kind: _kind, attach: _attach, ...snapshot } = event
      return { kind: "snapshot", snapshot }
    }
    case "session.records":
      return { kind: "records", attach_id: event.attach_id, records: event.records }
    case "session.attach_pending":
      return { kind: "pending", reason: event.reason }
    case "session.detached":
      return { kind: "detached", reason: event.reason }
  }
}

export function openAttach(client: LocalApiClient, device: string, sessionId: string): Promise<RemoteAttach> {
  // Events of the new attach can arrive before its handle is known, so they wait here until the response names it.
  const early: AttachEvent[] = []
  const history: RemoteAttachEvent[] = []
  const listeners = new Set<(event: RemoteAttachEvent) => void>()
  let handle: string | undefined
  let resolveSnapshot!: (snapshot: SnapshotBody) => void
  let rejectSnapshot!: (error: Error) => void
  const snapshot = new Promise<SnapshotBody>((resolve, reject) => {
    resolveSnapshot = resolve
    rejectSnapshot = reject
  })
  snapshot.catch(() => {})
  let resolveDetached!: (reason: AttachEnd) => void
  const detached = new Promise<AttachEnd>(resolve => {
    resolveDetached = resolve
  })
  let ended = false
  let failure: unknown
  const finish = (reason: AttachEnd) => {
    if (ended) return
    ended = true
    stop()
    listeners.clear()
    rejectSnapshot(new Error(`the attach ended before its snapshot: ${reason}`))
    resolveDetached(reason)
  }
  // Listeners run inside the connection's data handler: a throw there must end this attach, never the connection.
  const deliver = (event: AttachEvent) => {
    const remote = toRemote(event)
    if (remote.kind === "snapshot") {
      history.length = 0
      resolveSnapshot(remote.snapshot)
    }
    history.push(remote)
    for (const listener of [...listeners]) {
      try {
        listener(remote)
      } catch (error) {
        failure = error
        finish("listener_failed")
        return
      }
    }
    if (remote.kind === "detached") finish(remote.reason)
  }
  const stop = client.onEvent(event => {
    const mine = attachEvent(event)
    if (mine === undefined) return
    if (handle === undefined) early.push(mine)
    else if (mine.attach === handle) deliver(mine)
  })
  void client.closed.then(() => finish("closed"))
  return client.request("session.attach", { device, session_id: sessionId }).then(
    ({ attach }) => {
      handle = attach
      for (const event of early.splice(0)) if (event.attach === attach) deliver(event)
      return {
        device,
        sessionId,
        handle: attach,
        snapshot,
        detached,
        onEvent: listener => {
          for (const event of history) listener(event)
          if (!ended) listeners.add(listener)
          return () => listeners.delete(listener)
        },
        failure: () => failure,
        read: (options = {}) =>
          client.read(attach, {
            ...(options.before === undefined ? {} : { before_entry_id: options.before }),
            ...(options.tail === undefined ? {} : { tail: options.tail }),
          }),
        detach: async () => {
          try {
            await client.request("session.detach", { attach })
          } catch (error) {
            if (!(error instanceof LocalApiError && error.code === "not_attached")) throw error
          }
          finish("detached")
        },
      }
    },
    (error: unknown) => {
      stop()
      throw error
    },
  )
}
