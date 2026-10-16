import type { EffectiveModelChange, EffectiveModelChangeKind, EffectiveModelSource, TaskRecord } from "../state"
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

export function toStorableTaskRecord(record: TaskRecord): TaskRecord {
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
