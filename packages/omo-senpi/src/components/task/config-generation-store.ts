import type { TaskRecord, TaskRecordStore } from "@oh-my-opencode/senpi-task"

/**
 * Stamp the planning-time category config generation onto records as they are persisted, which is
 * what binds a task to the config snapshot that actually planned it. The manager claims a fresh
 * record right after the planner resolved it, so the generation current at that moment is this
 * task's generation.
 *
 * The stamp is sticky, never re-stamped: `save`/`replace` of a record that carries no generation
 * inherits persisted provenance, including unknown. The manager's post-claim rewrite (spawn_spec)
 * and every later bookkeeping write keep the original planning generation instead of picking up a
 * newer session's configuration.
 */
export function createConfigGenerationStampingStore(
  backing: TaskRecordStore,
  currentGeneration: () => number | undefined,
): TaskRecordStore {
  const stamp = (record: TaskRecord): TaskRecord => {
    if (record.config_generation !== undefined) return record
    const persisted = backing.load(record.task_id)
    const generation = persisted === null ? currentGeneration() : persisted.config_generation
    return generation === undefined ? record : { ...record, config_generation: generation }
  }
  return {
    ...backing,
    save: (record) => backing.save(stamp(record)),
    replace: (record) => backing.replace(stamp(record)),
  }
}
