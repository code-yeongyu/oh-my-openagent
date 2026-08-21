import type { TaskRecord, TaskRecordStore } from "@oh-my-opencode/senpi-task"

/**
 * Stamp the planning-time category config generation onto records as they are persisted, which is
 * what binds a task to the config snapshot that actually planned it. The manager claims a fresh
 * record right after the planner resolved it, so the generation current at that moment is this
 * task's generation.
 *
 * The stamp is sticky, never re-stamped: `save`/`replace` of a record that carries no generation
 * inherits the persisted one when it exists, so the manager's post-claim rewrite (spawn_spec) and
 * every later bookkeeping write keep the original planning generation instead of picking up a
 * newer session's configuration.
 */
export function createConfigGenerationStampingStore(
  backing: TaskRecordStore,
  currentGeneration: () => number | undefined,
): TaskRecordStore {
  const stamp = (record: TaskRecord): TaskRecord => {
    if (record.config_generation !== undefined) return record
    const generation = persistedGeneration(backing, record.task_id) ?? currentGeneration()
    return generation === undefined ? record : { ...record, config_generation: generation }
  }
  return {
    ...backing,
    save: (record) => backing.save(stamp(record)),
    replace: (record) => backing.replace(stamp(record)),
  }
}

// An unreadable or absent record simply has no generation to inherit; the write must not fail for it.
function persistedGeneration(backing: TaskRecordStore, taskId: string): number | undefined {
  try {
    return backing.load(taskId)?.config_generation
  } catch {
    return undefined
  }
}
