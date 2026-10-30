import type { HostSessionIdentity, RunnerKind } from "../state"
import { isRecord, readNumber, readOptionalNumber, readOptionalString, readString } from "./scalar-read"

export function parseOptionalHostSession(
  record: Record<string, unknown>,
): HostSessionIdentity | undefined {
  const value = record["host_session"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("host_session is not an object")
  const socket = readString(value, "socket")
  const routingId = readString(value, "routing_id")
  const sessionPath = readString(value, "session_path")
  const instanceId = readString(value, "instance_id")
  const daemonPid = readOptionalNumber(value, "daemon_pid")
  const adoptedEntryId = readOptionalString(value, "adopted_entry_id")
  return {
    socket,
    routing_id: routingId,
    session_path: sessionPath,
    instance_id: instanceId,
    ...(value.effect_seq === undefined ? {} : { effect_seq: readNumber(value, "effect_seq") }),
    ...(daemonPid === undefined ? {} : { daemon_pid: daemonPid }),
    ...(adoptedEntryId === undefined ? {} : { adopted_entry_id: adoptedEntryId }),
  }
}

export function validateHostSessionConsistency(
  runnerKind: RunnerKind | undefined,
  hostSession: HostSessionIdentity | undefined,
): void {
  if (hostSession !== undefined && runnerKind !== "host-session") {
    throw new Error("host_session present but runner_kind is not 'host-session'")
  }
}
