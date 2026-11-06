import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"

export async function settlePaused(
  ports: {
    readonly store: TaskRecordStore
    readonly now: () => number
    readonly liveHandle: (taskId: string) => ManagedChildHandle | undefined
    readonly parkSlot?: (taskId: string, epoch: number) => void
    readonly pauseSettlement?: (taskId: string, epoch: number) => Promise<void> | undefined
  },
  taskId: string,
  handle: ManagedChildHandle,
  epoch: number,
  acknowledged: Promise<void>,
): Promise<boolean> {
  await acknowledged
  if (ports.pauseSettlement?.(taskId, epoch) !== acknowledged) return false
  if (ports.liveHandle(taskId) !== handle) return true
  const record = ports.store.load(taskId)
  if (record?.notification.run_epoch !== epoch) return true
  if (record.status !== "running" && record.status !== "paused") return true
  if (record.status === "running") ports.store.transition(taskId, {
    type: "pause", timestamp: new Date(ports.now()).toISOString(),
  })
  ports.parkSlot?.(taskId, epoch)
  return true
}
