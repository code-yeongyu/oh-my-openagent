import { createTaskRecordStore } from "./record-store"
import { R0_FAILURE_REASONS, R0_SUSPENSION_REASONS } from "./rollback-r0-contract"

const r0SuspensionReasons = new Set<string>(R0_SUSPENSION_REASONS)
const r0FailureReasons = new Set<string>(R0_FAILURE_REASONS)

export type HostSessionMigrationPlan = {
  readonly store_dir: string
  readonly migrate: number
  readonly skipped: number
  readonly sockets: readonly string[]
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
  return {
    store_dir: storeDir,
    migrate: candidates.length,
    skipped: listing.records.length - candidates.length,
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
  },
  to: string,
): boolean {
  return (
    (record.host_session !== undefined && record.host_session.socket !== to) ||
    (record.suspension_reason !== undefined && !r0SuspensionReasons.has(record.suspension_reason)) ||
    (record.failure_reason !== undefined && !r0FailureReasons.has(record.failure_reason))
  )
}
