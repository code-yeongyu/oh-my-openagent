import * as z from "zod"

export const CHILD_PERMISSION_EVENT = "computer.permission_required"
export const TASK_CHILD_EXTENSION_EVENT = "omo.task.child_extension_event"

const permissionEventSchema = z.object({
  type: z.literal(CHILD_PERMISSION_EVENT),
  permission: z.enum(["screen_recording", "accessibility"]),
  app: z.string().optional(),
})

export type ChildExtensionEvent = z.infer<typeof permissionEventSchema>
export type ChildExtensionListener = (event: ChildExtensionEvent) => void

export function parseChildExtensionEvent(value: unknown): ChildExtensionEvent | undefined {
  const parsed = permissionEventSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** A separate channel: these records never masquerade as AgentSessionEvent. */
export function createChildExtensionEvents() {
  const listeners = new Set<ChildExtensionListener>()
  const pending: ChildExtensionEvent[] = []
  let attached = false
  let retired = false
  const publish = (event: ChildExtensionEvent): void => {
    if (retired) return
    if (!attached) pending.push(event)
    else for (const listener of listeners) listener(event)
  }
  return {
    publish,
    ingest(record: unknown): boolean {
      if (
        typeof record !== "object" || record === null ||
        !("type" in record) || record.type !== "extension_event" ||
        !("name" in record) || record.name !== CHILD_PERMISSION_EVENT
      ) return false
      const event = parseChildExtensionEvent("data" in record ? record.data : undefined)
      if (event !== undefined) publish(event)
      return true
    },
    subscribe(listener: ChildExtensionListener): () => void {
      if (retired) return () => {}
      listeners.add(listener)
      attached = true
      for (const event of pending.splice(0)) listener(event)
      return () => { listeners.delete(listener) }
    },
    clear(): void {
      retired = true
      pending.length = 0
      listeners.clear()
    },
  }
}
