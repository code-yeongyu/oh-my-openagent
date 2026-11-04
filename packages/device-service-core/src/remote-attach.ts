import { randomBytes } from "node:crypto"

import { type DelegatedChannel, followDelegatedChannel } from "./delegated-channel.ts"
import type { LocalApiClient } from "./local-api/client.ts"
import type { ReadPage } from "./local-api/client-assembly.ts"
import { LocalApiError } from "./local-api/errors.ts"
import type {
  AttachPendingReason,
  CommandRpc,
  CommandStateEvent,
  DetachReason,
  JsonObject,
  LocalEvent,
  SnapshotBody,
} from "./local-api/protocol.ts"

/** How an attach ended: a service-reported reason, the connection closing, or this client's own detach. */
export type AttachEnd = DetachReason | "closed" | "detached" | "listener_failed"

export type RemoteAttachEvent =
  | { readonly kind: "pending"; readonly reason: AttachPendingReason }
  | { readonly kind: "snapshot"; readonly snapshot: SnapshotBody }
  | { readonly kind: "records"; readonly attach_id: number; readonly records: readonly JsonObject[] }
  | { readonly kind: "detached"; readonly reason: DetachReason }

/** A forwarded record's outcome: its final command state, and the engine's own reply when the host sent one. */
export type CommandResult = { readonly outcome: CommandStateEvent; readonly response?: JsonObject }

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
  /**
   * Sends one engine RPC record, unchanged, to the attached session's host on this connection's delegated channel
   * (`session.command {attach, rpc, delegated: true}`) and settles with the first command state that is not a progress
   * state, plus the engine's reply when the host sent one (a host without delegated commands sends none). Rejects with
   * the local API's refusal, or when the attach ends first.
   */
  readonly command: (rpc: CommandRpc) => Promise<CommandResult>
  /** The frames the host's engine writes unasked on the delegated channel (dialog requests, session events). */
  readonly onFrame: (listener: (frame: JsonObject) => void) => () => void
  /** A delegated reply or frame that was lost, or the channel closing, with the reason. */
  readonly onChannelLoss: (listener: (reason: string) => void) => () => void
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

// The sender ledger's progress states (local API command_state): every other state ends the command.
const PROGRESS_STATES: ReadonlySet<CommandStateEvent["state"]> = new Set(["queued", "transport_confirmed", "engine_dispatched"])

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
  const commands = new Set<(reason: AttachEnd) => void>()
  let channel: DelegatedChannel | undefined
  const finish = (reason: AttachEnd) => {
    if (ended) return
    ended = true
    stop()
    channel?.stop()
    listeners.clear()
    for (const end of [...commands]) end(reason)
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
      const delegated = followDelegatedChannel(client, device)
      channel = delegated
      if (ended) delegated.stop()
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
        onFrame: listener => delegated.onFrame(listener),
        onChannelLoss: listener => delegated.onLoss(listener),
        command: rpc =>
          new Promise<CommandResult>((resolve, reject) => {
            if (ended) return reject(new Error("the attach has ended"))
            // Minted here, before sending, so a state that arrives ahead of the answer is not missed.
            const commandId = randomBytes(16).toString("base64url")
            const settle = (): void => {
              stopState()
              commands.delete(end)
            }
            const end = (reason: AttachEnd): void => {
              settle()
              reject(new Error(`the attach ended before the command settled: ${reason}`))
            }
            const stopState = client.onEvent(event => {
              if (event.kind !== "session.command_state" || event.command_id !== commandId) return
              if (PROGRESS_STATES.has(event.state)) return
              settle()
              const response = delegated.takeReply(commandId)
              resolve(response === undefined ? { outcome: event } : { outcome: event, response })
            })
            commands.add(end)
            client.command(attach, rpc, commandId, { delegated: true }).catch((error: unknown) => {
              settle()
              reject(error)
            })
          }),
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
