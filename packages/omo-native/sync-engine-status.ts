import { lstat } from "node:fs/promises"

import { probeSocket } from "../senpi-task/src/runners/rpc-host/busy-host"
import { resolveTaskHostSocket } from "../senpi-task/src/runners/rpc-host/daemon-contract"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"

// `omo sync status` (#14435) says whether this machine's engine host is running. It does not read that engine's memory
// sync state: the engine answers `omo.memory.sync.status` only inside a session, and reaching one from here would
// attach to (and so resume and re-park) a session another surface owns. Until the engine offers a session-less,
// observing read of it (senpi#7107, wired here by #14456), the CLI reports presence only, by connecting to the operator
// socket and closing without sending a request, which neither authenticates nor attaches. One side effect remains: on
// POSIX the host supervisor counts any accepted connection as activity, so a probe resets an idle engine's idle-exit
// clock (it does not keep the engine alive beyond one more idle window). The observing read removes that too.

export type EngineSyncRead =
  /** No engine host listens on this machine's operator socket. */
  | { readonly kind: "no_engine" }
  /** An engine host listens; its sync state is shown inside its sessions (TUI footer, desktop). */
  | { readonly kind: "running" }
  /** The socket could not be checked; `reason` names why. */
  | { readonly kind: "unreadable"; readonly reason: string }

export async function readEngineSyncStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<EngineSyncRead> {
  if (process.platform === "win32") return { kind: "unreadable", reason: "the operator endpoint is not a socket here" }
  const socket = resolveTaskHostSocket(env, canonicalAgentDir(env))
  try {
    if (!(await lstat(socket)).isSocket()) return { kind: "no_engine" }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "no_engine" }
    return { kind: "unreadable", reason: error instanceof Error ? error.message : "the socket could not be read" }
  }
  const probe = await probeSocket(socket)
  switch (probe.kind) {
    case "accepts":
      return { kind: "running" }
    case "refused":
      return { kind: "no_engine" }
    case "unknown":
      return { kind: "unreadable", reason: `the engine host could not be checked: ${probe.reason}` }
  }
}
