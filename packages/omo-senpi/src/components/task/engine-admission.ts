import type { SpawnAdmission, TaskLifecycle } from "@oh-my-opencode/senpi-task"

/** Keep the residents on a rejection so a caller can distinguish busy siblings from a dead end. */
export async function admitAdapter(lifecycle: TaskLifecycle, parentSessionId: string): Promise<SpawnAdmission> {
  const admission = await lifecycle.admitResident(parentSessionId)
  if (admission.kind === "admitted") return { kind: "admitted" }
  if (admission.kind === "evicted") return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
  return {
    kind: "rejected",
    message: admission.error.message,
    max_children: admission.error.max_children,
    residents: admission.error.residents,
  }
}
