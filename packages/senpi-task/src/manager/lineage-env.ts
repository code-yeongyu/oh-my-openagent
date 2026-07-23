import type { TaskRecord } from "../state"

export const SENPI_TASK_LINEAGE_TASK_ID_ENV = "SENPI_TASK_LINEAGE_TASK_ID"

export function buildTaskLineageEnv(
  record: TaskRecord,
  env: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return { ...env, [SENPI_TASK_LINEAGE_TASK_ID_ENV]: record.task_id }
}
