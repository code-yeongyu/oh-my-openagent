import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import type { ChildEventListener } from "../types"
import { createHostSessionHandle } from "./handle"
import type { HostSessionChildHandle, HostSessionLiveness, HostSessionPort } from "./handle-port"
import { HostSessionDetachedError, type HostSessionClient, type HostSessionClosed, type HostSessionCommand, type HostSessionParked } from "./session-client"
import { childOpenInput } from "./session-client.test-support"

/** The fixture's session identity: the same triple a record stores as `host_session`. */
export const FAKE_SESSION = {
  routingId: "routing-1",
  sessionPath: "/tmp/sessions/handle.jsonl",
  instanceId: "inst-1",
} as const

/** The wire carries no compile-time variant; suites name the event they mean and cast once here. */
export function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent
}

export interface FakeSessionPort extends HostSessionPort {
  readonly sent: readonly HostSessionCommand[]
  readonly closes: number
  readonly detaches: number
  emitEvent(event: AgentSessionEvent): void
  emitParked(parked: HostSessionParked): void
  emitClosed(closed: HostSessionClosed): void
  loseTransport(): void
  /** Resolves the first time the handle's heartbeat reads `get_state`. */
  stateAsked(): Promise<void>
  /** Answer that read; awaiting the returned promise runs after the handle consumed it. */
  answerState(liveness: HostSessionLiveness): Promise<HostSessionLiveness>
  /** Resolves once the handle's heartbeat has attempted `count` state reads - a tick observed, never polled for. */
  stateRead(count: number): Promise<void>
  /** Mirror a real `SessionClient` after its connection dropped: every state read now throws in place. */
  failStateWithSyncThrow(): void
}

/**
 * An in-memory session: a real implementation of the port the handle drives, so turn delivery and
 * outcome tracking are proven without a socket. `answer` decides how the host replies to a command.
 */
export function fakeSessionPort(
  answer: (command: HostSessionCommand) => Promise<void> = () => Promise.resolve(),
): FakeSessionPort {
  const sent: HostSessionCommand[] = []
  const eventListeners = new Set<ChildEventListener>()
  const parkedListeners = new Set<(parked: HostSessionParked) => void>()
  const closedListeners = new Set<(closed: HostSessionClosed) => void>()
  const transport = Promise.withResolvers<unknown>()
  const stateAsked = Promise.withResolvers<void>()
  const stateAnswer = Promise.withResolvers<HostSessionLiveness>()
  const stateReadWaiters: Array<{ count: number; resolve: () => void }> = []
  let stateReadCount = 0
  let failStateSync = false
  let closes = 0
  let detaches = 0
  return {
    socketPath: "/tmp/dh-fake/rpc.sock",
    transportGone: transport.promise,
    get sent() {
      return sent
    },
    get closes() {
      return closes
    },
    get detaches() {
      return detaches
    },
    send: (command) => {
      sent.push(command)
      return answer(command)
    },
    getState: () => {
      stateReadCount += 1
      for (let index = stateReadWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = stateReadWaiters[index]
        if (waiter === undefined || waiter.count !== stateReadCount) continue
        stateReadWaiters.splice(index, 1)
        waiter.resolve()
      }
      stateAsked.resolve()
      if (failStateSync) throw new HostSessionDetachedError("get_state")
      return stateAnswer.promise
    },
    onEvent: (listener) => {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    onParked: (listener) => {
      parkedListeners.add(listener)
      return () => parkedListeners.delete(listener)
    },
    onClosed: (listener) => {
      closedListeners.add(listener)
      return () => closedListeners.delete(listener)
    },
    close: () => {
      closes += 1
      return Promise.resolve()
    },
    detach: () => {
      detaches += 1
      return Promise.resolve()
    },
    emitEvent: (emitted) => {
      for (const listener of eventListeners) listener(emitted)
    },
    emitParked: (parked) => {
      for (const listener of parkedListeners) listener(parked)
    },
    emitClosed: (closed) => {
      for (const listener of closedListeners) listener(closed)
    },
    loseTransport: () => transport.resolve(new Error("rpc_transport_gone")),
    stateAsked: () => stateAsked.promise,
    answerState: (liveness) => {
      stateAnswer.resolve(liveness)
      return stateAnswer.promise
    },
    stateRead: (count) =>
      stateReadCount >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => stateReadWaiters.push({ count, resolve })),
    failStateWithSyncThrow: () => {
      failStateSync = true
    },
  }
}

export function handleOverPort(client: FakeSessionPort, heartbeatIntervalMs = 60_000): HostSessionChildHandle {
  return createHostSessionHandle({
    client,
    session: FAKE_SESSION,
    taskId: "st_29_delivery",
    heartbeatIntervalMs,
    now: () => 7,
    closeGraceMs: 25,
  })
}

/** Open a real session on the fake host and wrap it in the handle under test. */
export async function openHostSessionHandle(input: {
  readonly client: HostSessionClient
  readonly sessionPath: string
  readonly closeGraceMs?: number
}): Promise<HostSessionChildHandle> {
  const opened = await input.client.open(childOpenInput(input.sessionPath))
  return createHostSessionHandle({
    client: input.client,
    session: { routingId: opened.sessionId, sessionPath: input.sessionPath, instanceId: opened.instanceId },
    taskId: "st_29_host",
    heartbeatIntervalMs: 60_000,
    now: () => 11,
    closeGraceMs: input.closeGraceMs ?? 100,
  })
}
