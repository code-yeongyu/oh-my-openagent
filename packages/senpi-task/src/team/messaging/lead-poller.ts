import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { ackMessages, commitDeliveryReservation, isMessageConsumed, listUnreadMessages, releaseDeliveryReservation, reserveMessageForDelivery, withInboxConsumerLease, type DeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { getInboxDir, resolveBaseDir } from "@oh-my-opencode/team-core/team-registry"
import { MessageSchema, type Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import { TEAM_LEAD_SENTINEL } from "../normalize"
import { buildPeerMessageEnvelope } from "./message"
import { createSessionMarkerIndex, type SessionMarkerIndex } from "./session-marker-index"
import type { WaitClaim, WaitRegistry } from "./wait-registry"

const DEAD_PID_LEASE_STALE_MS = 0
const RESERVED_PREFIX = ".delivering-"
const RESERVED_SUFFIX = ".json"

export type LeadInjection = Readonly<{ key: string; source: "team-message"; content: string; onFlushed?: () => void }>

export type LeadInjectionSink = { enqueue(injection: LeadInjection): void }

export type LeadPollFilter = Readonly<{ from?: string }>

export type LeadPoller = { pollOnce(filter?: LeadPollFilter): Promise<void>; shutdown(): void }

export type LeadPollerDeps = {
  readonly teamRunId: string; readonly config: TeamModeConfig
  readonly coordinator: LeadInjectionSink; readonly waitRegistry: WaitRegistry<Message>
  readonly appendEvent?: (taskId: string, event: PersistedTaskEvent) => void
  readonly eventTaskId: (message: Message) => string | undefined; readonly leadSessionFile?: () => string | undefined
}

type PendingPhase = "awaiting_flush" | "awaiting_persistence" | "recovery"

type PendingDelivery = { readonly message: Message; readonly reservation: DeliveryReservation; phase: PendingPhase }
type LeadPollState = {
  readonly pending: Map<string, PendingDelivery>
  readonly isStopped: () => boolean
  readonly markerIndex: SessionMarkerIndex
}

class InvalidReservedLeadMessageError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Invalid reserved lead team message: ${path}`)
    this.name = "InvalidReservedLeadMessageError"
    this.path = path
  }
}

export function createLeadPoller(deps: LeadPollerDeps): LeadPoller {
  const pending = new Map<string, PendingDelivery>()
  let stopped = false
  const state: LeadPollState = { pending, isStopped: () => stopped, markerIndex: createSessionMarkerIndex() }
  const withLease = <T>(fn: () => Promise<T>): Promise<T> => withInboxConsumerLease(
    deps.teamRunId, TEAM_LEAD_SENTINEL, deps.config, fn, { staleAfterMs: DEAD_PID_LEASE_STALE_MS },
  )

  return {
    async pollOnce(filter = {}) {
      if (stopped) return
      await withLease(async () => {
        await settlePending(deps, state)
        await recoverReservations(deps, state)
        const messages = await listUnreadMessages(deps.teamRunId, TEAM_LEAD_SENTINEL, deps.config)
        for (const message of messages) {
          if (filter.from !== undefined && message.from !== filter.from) continue
          await processMessage(deps, message, state)
        }
      })
    },
    shutdown() {
      stopped = true
    },
  }
}

async function settlePending(deps: LeadPollerDeps, state: LeadPollState): Promise<void> {
  for (const delivery of [...state.pending.values()]) {
    let releaseWhenMissing: boolean
    switch (delivery.phase) {
      case "awaiting_flush": continue
      case "awaiting_persistence": releaseWhenMissing = false; break
      case "recovery": releaseWhenMissing = true; break
      default: {
        const exhaustive: never = delivery.phase
        throw new TypeError(`Unexpected lead delivery phase: ${exhaustive}`)
      }
    }
    const sessionFile = deps.leadSessionFile?.()
    if (sessionFile === undefined) continue
    const persisted = await state.markerIndex.contains(sessionFile, delivery.message.messageId)
    if (!persisted && !releaseWhenMissing) continue
    if (!persisted) {
      await releaseDeliveryReservation(delivery.reservation)
      state.pending.delete(delivery.message.messageId)
      continue
    }
    await commitDeliveryReservation(delivery.reservation)
    state.pending.delete(delivery.message.messageId)
    appendDeliveredEvent(deps, delivery.message)
  }
}

async function processMessage(deps: LeadPollerDeps, message: Message, state: LeadPollState): Promise<void> {
  if (await isMessageConsumed(deps.teamRunId, TEAM_LEAD_SENTINEL, message.messageId, deps.config)) {
    await ackMessages(deps.teamRunId, TEAM_LEAD_SENTINEL, [message.messageId], deps.config)
    return
  }

  const reservation = await reserveMessageForDelivery(
    deps.teamRunId, TEAM_LEAD_SENTINEL, message.messageId, deps.config,
  )
  if (reservation === null) return
  if (state.isStopped()) {
    await releaseDeliveryReservation(reservation)
    return
  }

  const sessionFile = deps.leadSessionFile?.()
  if (await state.markerIndex.contains(sessionFile, message.messageId)) {
    await commitDeliveryReservation(reservation)
    appendDeliveredEvent(deps, message)
    return
  }

  const waitClaim = deps.waitRegistry.takeMatch(deps.teamRunId, message)
  if (waitClaim !== undefined) {
    await resolveWait(deps, { message, reservation, phase: "awaiting_persistence" }, waitClaim)
    return
  }

  const delivery: PendingDelivery = { message, reservation, phase: "awaiting_flush" }
  state.pending.set(message.messageId, delivery)
  try {
    deps.coordinator.enqueue({
      key: `team-message:${message.messageId}`,
      source: "team-message",
      content: buildPeerMessageEnvelope(message),
      onFlushed: () => {
        const current = state.pending.get(message.messageId)
        if (current === delivery && current.phase === "awaiting_flush") current.phase = "awaiting_persistence"
      },
    })
  } catch (error) {
    state.pending.delete(message.messageId)
    await releaseDeliveryReservation(reservation)
    throw error
  }
}

async function resolveWait(
  deps: LeadPollerDeps,
  delivery: PendingDelivery,
  claim: WaitClaim<Message>,
): Promise<void> {
  if (!claim.isActive()) {
    await releaseDeliveryReservation(delivery.reservation)
    claim.abandon()
    return
  }

  let committed = false
  try {
    await commitDeliveryReservation(delivery.reservation)
    committed = true
    try {
      appendDeliveredEvent(deps, delivery.message)
      appendWaitedEvent(deps, delivery.message)
    } finally {
      claim.resolve()
    }
  } catch (error) {
    if (!committed) {
      await releaseDeliveryReservation(delivery.reservation)
      claim.abandon()
    }
    throw error
  }
}

async function recoverReservations(deps: LeadPollerDeps, state: LeadPollState): Promise<void> {
  let entries: string[]
  try {
    entries = (await readdir(inboxDir(deps)))
      .filter((name) => name.startsWith(RESERVED_PREFIX) && name.endsWith(RESERVED_SUFFIX))
      .toSorted()
  } catch (error) {
    if (isMissingPath(error)) return
    throw error
  }

  for (const entry of entries) {
    const message = await readReservedMessage(join(inboxDir(deps), entry))
    if (state.pending.has(message.messageId)) continue
    const reservation = await reserveMessageForDelivery(
      deps.teamRunId, TEAM_LEAD_SENTINEL, message.messageId, deps.config,
    )
    if (reservation === null) continue
    const sessionFile = deps.leadSessionFile?.()
    if (sessionFile === undefined) {
      state.pending.set(message.messageId, { message, reservation, phase: "recovery" })
    } else if (await state.markerIndex.contains(sessionFile, message.messageId)) {
      await commitDeliveryReservation(reservation)
      appendDeliveredEvent(deps, message)
    } else {
      await releaseDeliveryReservation(reservation)
    }
  }
}

async function readReservedMessage(path: string): Promise<Message> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new InvalidReservedLeadMessageError(path)
  }
  const parsed = MessageSchema.safeParse(value)
  if (!parsed.success) throw new InvalidReservedLeadMessageError(path)
  return parsed.data
}

function appendDeliveredEvent(deps: LeadPollerDeps, message: Message): void {
  const taskId = deps.eventTaskId(message)
  if (taskId === undefined) return
  deps.appendEvent?.(taskId, {
    type: "team_message_delivered",
    payload: { message_id: message.messageId, from: message.from, to: message.to, kind: message.kind },
  })
}

function appendWaitedEvent(deps: LeadPollerDeps, message: Message): void {
  const taskId = deps.eventTaskId(message)
  if (taskId === undefined) return
  deps.appendEvent?.(taskId, {
    type: "team_message_waited",
    payload: { message_id: message.messageId, from: message.from, body: message.body },
  })
}

function inboxDir(deps: LeadPollerDeps): string {
  return getInboxDir(resolveBaseDir(deps.config), deps.teamRunId, TEAM_LEAD_SENTINEL)
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
