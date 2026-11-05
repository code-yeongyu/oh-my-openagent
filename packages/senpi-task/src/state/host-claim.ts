import type { TaskRecord } from "./record-types"

// Every claim names the claiming process and, when known, the task manager inside it; a claim never
// keeps another manager's instance (#12349).
export function withHostClaim<T extends TaskRecord>(record: T, hostPid: number, managerInstance: string | undefined): T {
  const { host_manager_instance: _previous, ...rest } = record
  return { ...rest, host_pid: hostPid, ...(managerInstance === undefined ? {} : { host_manager_instance: managerInstance }) } as T
}
