import type { ActivityBus } from "../../activity-bus"

export function createTeamActivityBridge(bus: ActivityBus) {
  return {
    emitTeamCreated(data: { teamId: string; name: string; members: string[] }) {
      bus.emit({ kind: "team:created", data }).catch(() => {})
    },
    emitMemberStatus(data: { teamId: string; member: string; status: "active" | "idle" | "blocked" | "error" }) {
      bus.emit({ kind: "team:member:status", data }).catch(() => {})
    },
    emitTaskProgress(data: { teamId: string; completed: number; total: number }) {
      bus.emit({ kind: "team:task:progress", data }).catch(() => {})
    },
  }
}

export type TeamActivityBridge = ReturnType<typeof createTeamActivityBridge>
