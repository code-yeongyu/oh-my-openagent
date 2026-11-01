import { getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"

import type { EffectiveModelChange, EffectiveModelChangeKind, EffectiveModelSource, TaskRecord, TaskStatus } from "../state"
import { EFFECTIVE_MODEL_CHANGE_KINDS } from "../state"

function liveChangeKind(source: EffectiveModelSource): EffectiveModelChangeKind | undefined {
  return (EFFECTIVE_MODEL_CHANGE_KINDS as readonly string[]).includes(source)
    ? (source as EffectiveModelChangeKind)
    : undefined
}

// The on-disk encoding of effective_model (F12 rollback compatibility): the persisted `source`
// must only ever hold a value a pre-F12 build's parser accepts (category | explicit | agent), so
// a downgrade or an older process sharing the task store still loads the record - those builds
// rethrow any effective_model parse error in readRecord. A live change kind therefore moves into
// a nested `change` block those parsers drop, while `source` stores the child's original spawn
// source. In-memory records keep the live kind in `source`; only the persisted bytes change.

// The same rule for `status` (senpi#3811): R0 rejects a status outside its closed set, so a paused
// task is stored as `running` with the additive `paused: true` marker R0 ignores; readers of this
// build map the pair back to `paused`.
export type StoredPausedMarker = { readonly paused?: true }

export function storedStatus(status: TaskStatus): { readonly status: Exclude<TaskStatus, "paused"> } & StoredPausedMarker {
  return status === "paused" ? { status: "running", paused: true } : { status }
}

// Only the owner itself can say which process took a record: a write naming this process as host
// stamps it once with this process's own start identity, bound to this pid. The identity is read
// once, off the write path; a write before it is known stamps without it (no evidence either way)
// and the next write adds it. A stamp under this pid from before this process began came from an
// earlier holder of the pid, so it is replaced.
let ownStart: string | undefined
let ownStartRequested = false

function ownStartIdentity(): string | undefined {
  if (!ownStartRequested) {
    ownStartRequested = true
    void getProcessStartIdentity(process.pid).then(
      (identity) => { ownStart = identity ?? undefined },
      () => { ownStartRequested = false },
    )
  }
  return ownStart
}

function withHostClaim(record: TaskRecord): TaskRecord {
  if (record.host_pid !== process.pid) return record
  const start = ownStartIdentity()
  const claim = record.host_claim
  if (claim?.pid === process.pid && Date.parse(claim.at) >= performance.timeOrigin && claim.start === start) return record
  return { ...record, host_claim: { pid: process.pid, at: new Date().toISOString(), ...(start === undefined ? {} : { start }) } }
}

export function toStorableTaskRecord(record: TaskRecord): TaskRecord & StoredPausedMarker {
  const stored = storableEffectiveModel(withHostClaim(record))
  return stored.status === "paused" ? { ...stored, ...storedStatus(stored.status) } : stored
}

function storableEffectiveModel(record: TaskRecord): TaskRecord {
  const effective = record.effective_model
  if (effective === undefined) return record
  const kind = liveChangeKind(effective.source)
  if (kind === undefined) return record
  const { switched_by_operator: operatorFlag, ...fields } = effective
  // resolved_model keeps stating the spawn plan (fallback events replace its model, never its
  // source), so its source is the honest old-union value to persist.
  const stored: typeof effective & { readonly change: EffectiveModelChange } = {
    ...fields,
    source: record.resolved_model?.source ?? "explicit",
    change: {
      kind,
      ...(operatorFlag === undefined ? {} : { switched_by_operator: operatorFlag }),
    },
  }
  return { ...record, effective_model: stored }
}
