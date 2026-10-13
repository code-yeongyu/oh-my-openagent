import { log } from "@oh-my-opencode/utils/logger"
import { createTaskRecordStore } from "./record-store"
import { R0_FAILURE_KINDS, R0_FAILURE_REASONS, R0_SUSPENSION_REASONS } from "./rollback-r0-contract"

const r0SuspensionReasons = new Set<string>(R0_SUSPENSION_REASONS)
const r0FailureReasons = new Set<string>(R0_FAILURE_REASONS)
const r0FailureKinds = new Set<string>(R0_FAILURE_KINDS)

export type HostSessionMigrationPlan = {
  readonly store_dir: string
  readonly migrate: number
  readonly skipped: number
  readonly sockets: readonly string[]
  readonly warnings?: readonly {
    readonly code: "strict_closure_not_retried"
    readonly task_ids: readonly string[]
    readonly message: string
  }[]
}

export type HostSessionMigrationResult = HostSessionMigrationPlan & {
  readonly migrated: number
}

export function planHostSessionSocketMigration(storeDir: string, to: string): HostSessionMigrationPlan {
  const store = createTaskRecordStore({ project_dir: storeDir, task: { state_dir: storeDir } })
  const listing = store.list()
  if (listing.diagnostics.some((diagnostic) => diagnostic.type === "parse_error")) {
    throw new Error(`rollback migration refused malformed records in ${storeDir}`)
  }
  const candidates = listing.records.filter((record) => needsMigration(record, to))
  const strictTaskIds = listing.records
    .filter((record) => record.fallback_closing_child?.requires_confirmation === true)
    .map((record) => record.task_id)
    .toSorted()
  return {
    store_dir: storeDir,
    migrate: candidates.length,
    skipped: listing.records.length - candidates.length,
    ...(strictTaskIds.length === 0
      ? {}
      : {
          warnings: [
            {
              code: "strict_closure_not_retried" as const,
              task_ids: strictTaskIds,
              message:
                "The old daemon session may still be running and will no longer be retried for close by the older binary. A newer binary can resume closing only if the obligation field survives older writes.",
            },
          ],
        }),
    sockets: [
      ...new Set(
        candidates
          .map((record) => record.host_session?.socket)
          .filter((socket): socket is string => socket !== undefined && socket !== to),
      ),
    ].toSorted(),
  }
}

export function migrateHostSessionSockets(
  storeDir: string,
  options: {
    readonly to: string
    readonly deadEndpoints: ReadonlySet<string>
    readonly dryRun?: boolean
  },
): HostSessionMigrationResult {
  const plan = planHostSessionSocketMigration(storeDir, options.to)
  for (const socket of plan.sockets) {
    if (!options.deadEndpoints.has(socket)) throw new Error(`rollback migration refused live or unverified endpoint ${socket}`)
  }
  if (options.dryRun) return { ...plan, migrated: 0 }
  for (const warning of plan.warnings ?? []) {
    log(warning.message, {
      level: "warn",
      code: warning.code,
      task_ids: warning.task_ids,
    })
  }

  const store = createTaskRecordStore({ project_dir: storeDir, task: { state_dir: storeDir } })
  let migrated = 0
  for (const record of store.list().records) {
    const from = record.host_session?.socket
    if (!needsMigration(record, options.to)) continue
    const next = store.mutate(record.task_id, (current) => {
      if (!needsMigration(current, options.to)) return current
      const moveSocket = current.host_session !== undefined && current.host_session.socket !== options.to
      return {
        ...current,
        ...(moveSocket ? { host_session: { ...current.host_session, socket: options.to } } : {}),
        ...(current.suspension_reason !== undefined && !r0SuspensionReasons.has(current.suspension_reason)
          ? { suspension_reason: undefined }
          : {}),
        ...(current.failure_reason !== undefined && !r0FailureReasons.has(current.failure_reason)
          ? { failure_reason: undefined }
          : {}),
        ...(current.failure_kind !== undefined && !r0FailureKinds.has(current.failure_kind)
          ? {
              failure_kind:
                current.failure_kind === "suspended_unresumable" ? ("session_unavailable" as const) : undefined,
            }
          : {}),
      }
    })
    if (next === null) continue
    if (from !== undefined && from !== options.to) {
      store.appendEvent(record.task_id, {
        type: "host_session_migrated",
        payload: { from, to: options.to, reason: "rollback" },
      })
    }
    migrated += 1
  }
  return { ...plan, migrated }
}

function needsMigration(
  record: {
    readonly host_session?: { readonly socket: string }
    readonly suspension_reason?: string
    readonly failure_reason?: string
    readonly failure_kind?: string
  },
  to: string,
): boolean {
  return (
    (record.host_session !== undefined && record.host_session.socket !== to) ||
    (record.suspension_reason !== undefined && !r0SuspensionReasons.has(record.suspension_reason)) ||
    (record.failure_reason !== undefined && !r0FailureReasons.has(record.failure_reason)) ||
    (record.failure_kind !== undefined && !r0FailureKinds.has(record.failure_kind))
  )
}
