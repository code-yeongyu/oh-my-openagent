import {
  createIncrementalSessionMarkerIndex,
  parseTeamMemberTaskIdentity,
  type SessionMarkerIndex,
  type TaskRecord,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

export const TEAM_MEMBER_LIVENESS_MESSAGE_TYPE = "senpi-task.team-member-liveness"

export type TeamMemberLivenessDetails = {
  readonly memberName: string
  readonly lastKnownState: TaskStatus
  readonly reason?: string
}

type TeamMemberLivenessDeliveryDetails = TeamMemberLivenessDetails & {
  readonly deliveryKey: string
}

export type TeamMemberLivenessNotifier = {
  notifyTerminal(record: TaskRecord): void
  acknowledgePersisted(sessionFile: () => string | undefined): Promise<void>
}

export type TeamMemberLivenessNotifierDeps = {
  readonly pi: Pick<SenpiExtensionAPI, "sendMessage">
  readonly coordinator?: Pick<IdleInjectionCoordinator, "enqueue" | "scheduleFlush" | "flushSoon">
  readonly isStreaming: () => boolean
  readonly wasDelivered?: (record: TaskRecord) => boolean
  readonly markDelivered?: (record: TaskRecord) => void
  readonly markerIndex?: SessionMarkerIndex
  readonly scheduleRetry?: (retry: () => void) => void
  readonly maxDeliveryRetries?: number
  readonly maxPersistenceRetries?: number
  readonly onError?: (error: unknown) => void
}

const DELIVERY_KEY_PREFIX = "team-member-liveness:"
const WAKE_MESSAGE_TYPE = "omo-senpi:wake"
const DEFAULT_MAX_RETRIES = 3

export function createTeamMemberLivenessNotifier(
  deps: TeamMemberLivenessNotifierDeps,
): TeamMemberLivenessNotifier {
  const delivered = new Set<string>()
  const pendingAcknowledgement = new Map<string, TaskRecord>()
  const deliveryRetries = new Map<string, number>()
  const markerIndex = deps.markerIndex
    ?? createIncrementalSessionMarkerIndex(livenessDeliveryKeysFromSessionText)
  const scheduleRetry = deps.scheduleRetry ?? defaultScheduleRetry
  const maxDeliveryRetries = deps.maxDeliveryRetries ?? DEFAULT_MAX_RETRIES
  const maxPersistenceRetries = deps.maxPersistenceRetries ?? DEFAULT_MAX_RETRIES
  let persistenceCheckActive = false
  let latestSessionFile: () => string | undefined = () => undefined

  const acknowledge = (deliveryKey: string): void => {
    const record = pendingAcknowledgement.get(deliveryKey)
    if (record === undefined) return
    deps.markDelivered?.(record)
    pendingAcknowledgement.delete(deliveryKey)
    deliveryRetries.delete(deliveryKey)
    delivered.delete(deliveryKey)
  }

  const failDelivery = (deliveryKey: string, record: TaskRecord, error: unknown): void => {
    if (pendingAcknowledgement.get(deliveryKey) !== record) return
    pendingAcknowledgement.delete(deliveryKey)
    delivered.delete(deliveryKey)
    deps.onError?.(error)
    const retryCount = deliveryRetries.get(deliveryKey) ?? 0
    if (retryCount >= maxDeliveryRetries) {
      deliveryRetries.delete(deliveryKey)
      return
    }
    deliveryRetries.set(deliveryKey, retryCount + 1)
    scheduleRetry(() => notifyTerminal(record))
  }

  const notifyTerminal = (record: TaskRecord): void => {
    const details = livenessDetails(record)
    if (details === undefined || deps.wasDelivered?.(record) === true) return
    const key = `${DELIVERY_KEY_PREFIX}${record.task_id}:${record.notification.run_epoch}`
    if (delivered.has(key)) return
    delivered.add(key)
    pendingAcknowledgement.set(key, record)
    const deliveryDetails: TeamMemberLivenessDeliveryDetails = { ...details, deliveryKey: key }
    const injection = {
      key,
      source: "team-liveness" as const,
      customType: TEAM_MEMBER_LIVENESS_MESSAGE_TYPE,
      content: livenessContent(details),
      display: false,
      details: deliveryDetails,
      onDeliveryFailed: (error: unknown) => failDelivery(key, record, error),
    }
    if (deps.coordinator !== undefined) {
      try {
        deps.coordinator.enqueue(injection)
        if (deps.isStreaming()) deps.coordinator.scheduleFlush()
        else deps.coordinator.flushSoon()
      } catch (error) {
        failDelivery(key, record, error)
      }
      return
    }
    try {
      const result = deps.pi.sendMessage({
        customType: injection.customType,
        content: injection.content,
        display: injection.display,
        details: injection.details,
      }, { triggerTurn: true, deliverAs: "steer" })
      if (isPromiseLike(result)) void result.catch((error: unknown) => failDelivery(key, record, error))
    } catch (error) {
      failDelivery(key, record, error)
    }
  }

  const checkPersistence = async (retriesRemaining: number): Promise<void> => {
    try {
      const sessionFile = latestSessionFile()
      for (const deliveryKey of [...pendingAcknowledgement.keys()]) {
        if (await markerIndex.contains(sessionFile, deliveryKey)) acknowledge(deliveryKey)
      }
    } catch (error) {
      deps.onError?.(error)
    }
    if (pendingAcknowledgement.size === 0 || retriesRemaining === 0) {
      persistenceCheckActive = false
      return
    }
    scheduleRetry(() => void checkPersistence(retriesRemaining - 1))
  }

  return {
    notifyTerminal,
    async acknowledgePersisted(sessionFile) {
      latestSessionFile = sessionFile
      if (persistenceCheckActive || pendingAcknowledgement.size === 0) return
      persistenceCheckActive = true
      await checkPersistence(maxPersistenceRetries)
    },
  }
}

export function livenessDeliveryKeys(payload: unknown): readonly string[] {
  if (!isRecord(payload) || !isRecord(payload.message)) return []
  return messageDeliveryKeys(payload.message)
}

export function livenessDeliveryKeysFromSessionText(text: string): readonly string[] {
  const keys = new Set<string>()
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
    if (!isRecord(entry) || entry.type !== "custom_message") continue
    for (const key of messageDeliveryKeys(entry)) keys.add(key)
  }
  return [...keys]
}

export function livenessDetails(record: TaskRecord): TeamMemberLivenessDetails | undefined {
  const memberName = parseTeamMemberTaskIdentity(record)?.memberName
  if (memberName === undefined || (record.status !== "error" && record.status !== "lost")) return undefined
  return {
    memberName,
    lastKnownState: record.status,
    ...(record.error_message === undefined ? {} : { reason: record.error_message }),
  }
}

export function livenessContent(details: TeamMemberLivenessDetails): string {
  const reason = details.reason === undefined ? "" : ` Reason: ${details.reason}`
  return `Team member liveness: ${details.memberName} exited abnormally; last known state: ${details.lastKnownState}.${reason}`
}

function messageDeliveryKeys(message: Record<string, unknown>): readonly string[] {
  if (message.customType === TEAM_MEMBER_LIVENESS_MESSAGE_TYPE) {
    const key = readDeliveryKey(message.details)
    return key === undefined ? [] : [key]
  }
  if (message.customType !== WAKE_MESSAGE_TYPE || !Array.isArray(message.details)) return []
  const keys = new Set<string>()
  for (const entry of message.details) {
    if (!isRecord(entry) || entry.customType !== TEAM_MEMBER_LIVENESS_MESSAGE_TYPE) continue
    const key = readDeliveryKey(entry.details)
    if (key !== undefined) keys.add(key)
  }
  return [...keys]
}

function readDeliveryKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const key = value.deliveryKey
  return typeof key === "string" && key.startsWith(DELIVERY_KEY_PREFIX) ? key : undefined
}

function defaultScheduleRetry(retry: () => void): void {
  const timer = setTimeout(retry, 50)
  timer.unref?.()
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return value !== undefined && typeof value.then === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
