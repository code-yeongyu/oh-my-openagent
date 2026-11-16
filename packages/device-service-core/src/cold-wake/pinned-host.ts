import { basename } from "node:path"

import { type ColdWakeHost, type ColdWakeOutcome, failed } from "./host.ts"
import type { SessionHostLaunch } from "./session-host-unit.ts"

// omo#13595 review M1: the unit's host never idle-exits, so removing the unit must end that host too, drained so a
// running turn finishes first. Only that host: the operator host (rpc.sock) whose launch carried the cold-start pin, as
// its `env_keys` in `omo daemon status --json` show. A host another omo started keeps its own idle exit.
const PIN_ENV = "SENPI_RPC_HOST_COLD_START"
const OPERATOR_SOCKET = "rpc.sock"
const NOT_RUNNING_EXIT = 3

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPinnedOperator = (endpoint: unknown): boolean =>
  isRecord(endpoint) &&
  typeof endpoint["socket"] === "string" &&
  basename(endpoint["socket"]) === OPERATOR_SOCKET &&
  endpoint["reachable"] === true &&
  Array.isArray(endpoint["env_keys"]) &&
  endpoint["env_keys"].includes(PIN_ENV)

const parseStatus = (output: string): unknown => {
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

/** Whether the agent dir's operator host runs with the pin; a failed read is a ColdWakeOutcome. */
export async function readPinnedHost(
  host: ColdWakeHost,
  launch: SessionHostLaunch,
): Promise<"pinned" | "none" | ColdWakeOutcome> {
  const status = await host.run(launch.omoCommand(["daemon", "status", "--json"]))
  if (status.exitCode === NOT_RUNNING_EXIT) return "none"
  const parsed = status.exitCode === 0 ? parseStatus(status.output) : undefined
  if (!isRecord(parsed) || !Array.isArray(parsed["endpoints"])) return failed("host_status", status.output)
  return parsed["endpoints"].some(isPinnedOperator) ? "pinned" : "none"
}

/** Undefined when there is nothing left to end (no host, or one this unit did not pin) or the pinned host was drained. */
export async function drainPinnedHost(
  host: ColdWakeHost,
  launch: SessionHostLaunch,
): Promise<ColdWakeOutcome | undefined> {
  const pinned = await readPinnedHost(host, launch)
  if (pinned !== "pinned") return pinned === "none" ? undefined : pinned
  const stopped = await host.run(launch.omoCommand(["daemon", "stop", "--drain"]))
  return stopped.exitCode === 0 ? undefined : failed("host_stop", stopped.output)
}
