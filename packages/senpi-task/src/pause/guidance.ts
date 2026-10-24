export type Guidance = {
  readonly id: string
  readonly revision: number
  readonly scope: { readonly kind: "run" } | { readonly kind: "node"; readonly nodeId: string }
  readonly text: string
  readonly state: "draft" | "dispatching" | "delivered" | "removed"
  readonly createdAt: string
  readonly editedAt?: string
  readonly deliveries: readonly { readonly taskId: string; readonly entryId?: string }[]
}

export class GuidanceError extends Error {
  constructor(readonly code: "not_found" | "frozen" | "duplicate_id") { super(code) }
}

export function addGuidance(
  records: readonly Guidance[],
  input: Pick<Guidance, "id" | "scope" | "text" | "createdAt">,
): readonly Guidance[] {
  if (records.some(record => record.id === input.id)) throw new GuidanceError("duplicate_id")
  return [...records, { ...input, revision: 0, state: "draft", deliveries: [] }]
}

export function changeGuidance(records: readonly Guidance[], input: {
  readonly id: string; readonly text?: string; readonly remove?: boolean; readonly editedAt: string
}): readonly Guidance[] {
  const current = records.find(record => record.id === input.id)
  if (current === undefined) throw new GuidanceError("not_found")
  if (current.state !== "draft") throw new GuidanceError("frozen")
  return records.map(record => record.id !== input.id ? record : {
    ...record, revision: record.revision + 1, editedAt: input.editedAt,
    ...(input.text === undefined ? {} : { text: input.text }),
    state: input.remove === true ? "removed" : "draft",
  })
}

export async function dispatchGuidance(
  initial: readonly Guidance[],
  targets: readonly { readonly nodeId: string; readonly taskId?: string }[],
  ports: {
    save(records: readonly Guidance[]): void
    deliver(taskId: string, input: { readonly inputId: string; readonly revision: number; readonly text: string }): Promise<{ readonly entryId?: string }>
  },
): Promise<void> {
  let records = initial
  const save = (record: Guidance): void => {
    records = records.map(entry => entry.id === record.id ? record : entry)
    ports.save(records)
  }
  for (const observed of [...initial].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (observed.state === "removed" || observed.state === "delivered") continue
    let guidance: Guidance = { ...observed, state: "dispatching" }
    save(guidance)
    const selected = targets.filter(target => guidance.scope.kind === "run" || guidance.scope.nodeId === target.nodeId)
    for (const target of selected) {
      if (target.taskId === undefined || guidance.deliveries.some(delivery => delivery.taskId === target.taskId)) continue
      const receipt = await ports.deliver(target.taskId, { inputId: guidance.id, revision: guidance.revision, text: guidance.text })
      guidance = { ...guidance, deliveries: [...guidance.deliveries, {
        taskId: target.taskId, ...(receipt.entryId === undefined ? {} : { entryId: receipt.entryId }),
      }] }
      save(guidance)
    }
    if (selected.every(target => target.taskId !== undefined && guidance.deliveries.some(delivery => delivery.taskId === target.taskId))) {
      save({ ...guidance, state: "delivered" })
    }
  }
}
