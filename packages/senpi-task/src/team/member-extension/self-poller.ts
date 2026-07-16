import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  ackMessages,
  commitDeliveryReservation,
  isMessageConsumed,
  listUnreadMessages,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
  withInboxConsumerLease,
  type DeliveryReservation,
} from "@oh-my-opencode/team-core/team-mailbox"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { getInboxDir } from "@oh-my-opencode/team-core/team-registry"
import { MessageSchema, type Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import { buildPeerMessageEnvelope } from "../messaging/message"
import type { WaitClaim, WaitRegistry } from "../messaging/wait-registry"

const DEAD_PID_LEASE_STALE_MS = 0
const RESERVED_PREFIX = ".delivering-"
const RESERVED_SUFFIX = ".json"

export type MemberSelfPollerDeps = {
  readonly teamRunId: string
  readonly memberName: string
  readonly config: TeamModeConfig
  readonly sessionDir: string
  readonly waitRegistry: WaitRegistry<Message>
  readonly sendUserMessage: (content: string) => void
  readonly appendEvent?: (event: PersistedTaskEvent) => void
  readonly afterInject?: (message: Message) => Promise<void>
}

export type MemberPollFilter = Readonly<{ from?: string }>

export type MemberSelfPoller = {
  pollOnce(filter?: MemberPollFilter): Promise<void>
  checkPendingAcks(): Promise<void>
  recoverReservations(): Promise<void>
  shutdown(): void
}

type PendingDelivery = { readonly message: Message; readonly reservation: DeliveryReservation }

type MemberPollState = {
  readonly pending: Map<string, PendingDelivery>
  readonly isStopped: () => boolean
}

class InvalidReservedMessageError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`Invalid reserved team message: ${path}`)
    this.name = "InvalidReservedMessageError"
    this.path = path
  }
}

export function createMemberSelfPoller(deps: MemberSelfPollerDeps): MemberSelfPoller {
  const pending = new Map<string, PendingDelivery>()
  let stopped = false
  const state: MemberPollState = { pending, isStopped: () => stopped }

  const withLease = <T>(fn: () => Promise<T>): Promise<T> => withInboxConsumerLease(
    deps.teamRunId,
    deps.memberName,
    deps.config,
    fn,
    { staleAfterMs: DEAD_PID_LEASE_STALE_MS },
  )

  const checkPendingUnderLease = async (): Promise<void> => {
    for (const delivery of [...pending.values()]) {
      if (!(await sessionJsonlContainsMessage(deps.sessionDir, delivery.message.messageId))) continue
      await commitDeliveryReservation(delivery.reservation)
      pending.delete(delivery.message.messageId)
      appendDeliveredEvent(deps, delivery.message)
    }
  }

  return {
    async pollOnce(filter = {}) {
      if (stopped) return
      await withLease(async () => {
        await checkPendingUnderLease()
        const messages = await listUnreadMessages(deps.teamRunId, deps.memberName, deps.config)
        for (const message of messages) {
          if (filter.from !== undefined && message.from !== filter.from) continue
          await processMessage(deps, message, state)
        }
      })
    },
    async checkPendingAcks() {
      if (stopped) return
      await withLease(checkPendingUnderLease)
    },
    async recoverReservations() {
      if (stopped) return
      await withLease(async () => recoverReservations(deps))
    },
    shutdown() {
      stopped = true
    },
  }
}

async function processMessage(
  deps: MemberSelfPollerDeps,
  message: Message,
  state: MemberPollState,
): Promise<void> {
  if (await isMessageConsumed(deps.teamRunId, deps.memberName, message.messageId, deps.config)) {
    await ackMessages(deps.teamRunId, deps.memberName, [message.messageId], deps.config)
    return
  }

  const reservation = await reserveMessageForDelivery(
    deps.teamRunId,
    deps.memberName,
    message.messageId,
    deps.config,
  )
  if (reservation === null) return

  if (state.isStopped()) {
    await releaseDeliveryReservation(reservation)
    return
  }

  if (await sessionJsonlContainsMessage(deps.sessionDir, message.messageId)) {
    await commitDeliveryReservation(reservation)
    appendDeliveredEvent(deps, message)
    return
  }

  const waitClaim = deps.waitRegistry.takeMatch(message)
  if (waitClaim !== undefined) {
    await resolveWait(deps, { message, reservation }, waitClaim)
    return
  }

  state.pending.set(message.messageId, { message, reservation })
  deps.sendUserMessage(buildPeerMessageEnvelope(message))
  await deps.afterInject?.(message)
}

async function resolveWait(
  deps: MemberSelfPollerDeps,
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
      deps.appendEvent?.({
        type: "team_message_waited",
        payload: {
          message_id: delivery.message.messageId,
          from: delivery.message.from,
          body: delivery.message.body,
        },
      })
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

async function recoverReservations(deps: MemberSelfPollerDeps): Promise<void> {
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
    const reservation = await reserveMessageForDelivery(
      deps.teamRunId,
      deps.memberName,
      message.messageId,
      deps.config,
    )
    if (reservation === null) continue
    if (await sessionJsonlContainsMessage(deps.sessionDir, message.messageId)) {
      await commitDeliveryReservation(reservation)
      appendDeliveredEvent(deps, message)
    } else {
      await releaseDeliveryReservation(reservation)
    }
  }
}

async function readReservedMessage(path: string): Promise<Message> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new InvalidReservedMessageError(path)
  }
  const parsed = MessageSchema.safeParse(parsedJson)
  if (!parsed.success) throw new InvalidReservedMessageError(path)
  return parsed.data
}

function inboxDir(deps: MemberSelfPollerDeps): string {
  return getInboxDir(deps.config.base_dir ?? "", deps.teamRunId, deps.memberName)
}

function appendDeliveredEvent(deps: MemberSelfPollerDeps, message: Message): void {
  deps.appendEvent?.({
    type: "team_message_delivered",
    payload: { message_id: message.messageId, from: message.from, to: message.to, kind: message.kind },
  })
}

export async function sessionJsonlContainsMessage(sessionDir: string, messageId: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).toSorted()
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }

  for (const entry of entries) {
    const text = await readFile(join(sessionDir, entry), "utf8")
    for (const line of text.split("\n")) {
      const value = parseJsonLine(line)
      if (containsEnvelopeMarker(value, messageId)) return true
    }
  }
  return false
}

function parseJsonLine(line: string): unknown {
  if (line.trim().length === 0) return undefined
  try {
    return JSON.parse(line)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function containsEnvelopeMarker(value: unknown, messageId: string): boolean {
  if (typeof value === "string") {
    return value.includes("<peer_message ") && value.includes(`messageId="${messageId}"`)
  }
  if (Array.isArray(value)) return value.some((entry) => containsEnvelopeMarker(entry, messageId))
  if (!isRecord(value)) return false
  return Object.values(value).some((entry) => containsEnvelopeMarker(entry, messageId))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
