import { z } from "zod"
import { isRecord } from "../../shared"

const MAX_CHECKPOINT_BYTES = 512
const MAX_TRACKED_ENTRIES = 256
const MAX_PARENT_NOTIFICATION_BYTES = 1_024
const checkpointStatusSchema = z.enum([
  "running",
  "succeeded",
  "nonzero_exit",
  "signal_exit",
  "cancelled",
  "hard_timeout",
  "output_limit",
  "runner_lost",
])

const byteCursorSchema = z.number().int().min(0).max(104_857_600)
const checkpointSchema = z.strictObject({
  schema_version: z.literal(1),
  event: z.literal("wait_checkpoint"),
  job_id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  status: checkpointStatusSchema,
  captured_bytes: byteCursorSchema,
  start_cursor_bytes: byteCursorSchema,
  next_cursor_bytes: byteCursorSchema,
  finished_at_unix_ms: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((checkpoint, context) => {
  if (checkpoint.start_cursor_bytes > checkpoint.next_cursor_bytes) {
    context.addIssue({ code: "custom", message: "start cursor exceeds next cursor" })
  }
  if (checkpoint.next_cursor_bytes > checkpoint.captured_bytes) {
    context.addIssue({ code: "custom", message: "next cursor exceeds captured bytes" })
  }
})

export type ManagedBashCheckpoint = Readonly<z.infer<typeof checkpointSchema>>

export type ManagedBashCheckpointScope = {
  readonly taskID: string
  readonly attemptID: string
}

export type ManagedBashCheckpointObservation = {
  readonly checkpoint: ManagedBashCheckpoint
  readonly latestOnlyKey: string
  readonly notification: string
}

type CorrelatedCall = {
  readonly scope: ManagedBashCheckpointScope
}

function stringField(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function recordField(record: Record<string, unknown> | undefined, field: string): Record<string, unknown> | undefined {
  const value = record?.[field]
  return isRecord(value) ? value : undefined
}

function scopeKey(scope: ManagedBashCheckpointScope): string {
  return `${scope.taskID}:${scope.attemptID}`
}

function callKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`
}

function scopesMatch(left: ManagedBashCheckpointScope, right: ManagedBashCheckpointScope): boolean {
  return left.taskID === right.taskID && left.attemptID === right.attemptID
}

function trimOldestEntry<K, V>(entries: Map<K, V>): void {
  if (entries.size < MAX_TRACKED_ENTRIES) return
  const oldestKey = entries.keys().next().value
  if (oldestKey !== undefined) entries.delete(oldestKey)
}

export function parseManagedBashCheckpoint(value: unknown): ManagedBashCheckpoint | undefined {
  const parsed = checkpointSchema.safeParse(value)
  if (!parsed.success) return undefined
  if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_CHECKPOINT_BYTES) return undefined
  return parsed.data
}

export function formatManagedBashCheckpointNotification(
  checkpoint: ManagedBashCheckpoint,
  taskID: string,
): string {
  const finishedLine = checkpoint.finished_at_unix_ms === undefined
    ? ""
    : `\n**Observed timestamp:** ${checkpoint.finished_at_unix_ms}`
  const notification = `<system-reminder>
[MANAGED BASH CHECKPOINT]
**Task:** \`${taskID.slice(0, 128)}\`
**Job:** \`${checkpoint.job_id}\`
**Status:** ${checkpoint.status}
**Captured bytes:** ${checkpoint.captured_bytes}
**Cursor:** ${checkpoint.start_cursor_bytes} -> ${checkpoint.next_cursor_bytes}${finishedLine}
The child task remains responsible for this managed job.
</system-reminder>`
  if (Buffer.byteLength(notification, "utf8") > MAX_PARENT_NOTIFICATION_BYTES) {
    return `<system-reminder>\n[MANAGED BASH CHECKPOINT]\n**Job:** \`${checkpoint.job_id}\`\n**Status:** ${checkpoint.status}\n</system-reminder>`
  }
  return notification
}

export class ManagedBashCheckpointObserver {
  private readonly calls = new Map<string, CorrelatedCall>()
  private readonly fingerprintsByAttempt = new Map<string, Set<string>>()
  private readonly latestKeysByAttempt = new Map<string, Set<string>>()
  private readonly latestCheckpointByKey = new Map<string, ManagedBashCheckpoint>()

  observeCalled(properties: unknown, scope: ManagedBashCheckpointScope): void {
    const props = isRecord(properties) ? properties : undefined
    const sessionID = stringField(props, "sessionID")
    const callID = stringField(props, "callID")
    const input = recordField(props, "input")
    if (!sessionID || !callID) return
    if (stringField(props, "tool") !== "managed_bash" || stringField(input, "action") !== "wait") return

    trimOldestEntry(this.calls)
    this.calls.set(callKey(sessionID, callID), { scope })
  }

  observeSuccess(
    properties: unknown,
    scope: ManagedBashCheckpointScope,
  ): ManagedBashCheckpointObservation | undefined {
    const props = isRecord(properties) ? properties : undefined
    const sessionID = stringField(props, "sessionID")
    const callID = stringField(props, "callID")
    if (!sessionID || !callID) return undefined

    const key = callKey(sessionID, callID)
    const call = this.calls.get(key)
    this.calls.delete(key)
    if (!call || !scopesMatch(call.scope, scope)) return undefined

    return this.acceptCheckpoint(
      recordField(props, "structured")?.managed_bash_checkpoint,
      scope,
    )
  }

  observeCompletedPart(
    properties: unknown,
    scope: ManagedBashCheckpointScope,
  ): ManagedBashCheckpointObservation | undefined {
    const props = isRecord(properties) ? properties : undefined
    const part = recordField(props, "part") ?? props
    const state = recordField(part, "state")
    if (stringField(part, "type") !== "tool" || stringField(part, "tool") !== "managed_bash") return undefined
    if (stringField(state, "status") !== "completed") return undefined
    if (stringField(recordField(state, "input"), "action") !== "wait") return undefined

    return this.acceptCheckpoint(
      recordField(state, "metadata")?.managed_bash_checkpoint,
      scope,
    )
  }

  purgeAttempt(scope: ManagedBashCheckpointScope): readonly string[] {
    const attemptKey = scopeKey(scope)
    for (const [key, call] of this.calls) {
      if (scopesMatch(call.scope, scope)) this.calls.delete(key)
    }
    this.fingerprintsByAttempt.delete(attemptKey)
    const latestKeys = [...(this.latestKeysByAttempt.get(attemptKey) ?? [])]
    for (const latestKey of latestKeys) this.latestCheckpointByKey.delete(latestKey)
    this.latestKeysByAttempt.delete(attemptKey)
    return latestKeys
  }

  clear(): void {
    this.calls.clear()
    this.fingerprintsByAttempt.clear()
    this.latestKeysByAttempt.clear()
    this.latestCheckpointByKey.clear()
  }

  private acceptCheckpoint(
    value: unknown,
    scope: ManagedBashCheckpointScope,
  ): ManagedBashCheckpointObservation | undefined {
    const checkpoint = parseManagedBashCheckpoint(value)
    if (!checkpoint) return undefined

    const attemptKey = scopeKey(scope)
    const latestOnlyKey = `managed-bash:${scope.taskID}:${scope.attemptID}:${checkpoint.job_id}`
    const latestKeys = this.latestKeysByAttempt.get(attemptKey) ?? new Set<string>()
    if (!latestKeys.has(latestOnlyKey) && latestKeys.size >= MAX_TRACKED_ENTRIES) return undefined
    const previousCheckpoint = this.latestCheckpointByKey.get(latestOnlyKey)
    if (
      previousCheckpoint
      && (
        checkpoint.captured_bytes < previousCheckpoint.captured_bytes
        || checkpoint.next_cursor_bytes < previousCheckpoint.next_cursor_bytes
      )
    ) {
      return undefined
    }

    const fingerprint = JSON.stringify(checkpoint)
    const fingerprints = this.fingerprintsByAttempt.get(attemptKey) ?? new Set<string>()
    if (fingerprints.has(fingerprint)) return undefined
    if (fingerprints.size >= MAX_TRACKED_ENTRIES) {
      const oldestFingerprint = fingerprints.values().next().value
      if (oldestFingerprint !== undefined) fingerprints.delete(oldestFingerprint)
    }
    fingerprints.add(fingerprint)
    this.fingerprintsByAttempt.set(attemptKey, fingerprints)

    latestKeys.add(latestOnlyKey)
    this.latestKeysByAttempt.set(attemptKey, latestKeys)
    this.latestCheckpointByKey.set(latestOnlyKey, checkpoint)
    return {
      checkpoint,
      latestOnlyKey,
      notification: formatManagedBashCheckpointNotification(checkpoint, scope.taskID),
    }
  }
}
