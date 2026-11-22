import { realpathSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import {
  resolveTaskHostSocket,
  TASK_HOST_SOCKET_ENV_NAMES,
} from "../../../../senpi-task/src/runners/rpc-host/daemon-contract"
import { resolveProjectStateDirectory } from "../../../../senpi-task/src/store/project-state-directory"
import type { SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"

/**
 * Socket overrides, most specific first: the engine's own brand-prefixed `RPC_SOCKET` names
 * (`envValue("RPC_SOCKET")` in senpi), then `OMO_RPC_SOCKET_PATH`, which the desktop sets on the
 * host it spawns so that host binds beside the CLI host instead of replacing it. The list and the
 * precedence live ONCE, beside the task daemon that attaches to the same socket.
 */
export const THREAD_SOCKET_ENV_NAMES = TASK_HOST_SOCKET_ENV_NAMES

/** Client for Senpi's existing supervisor-owned unix socket. It never starts or replaces a host. */
export function resolveThreadSocket(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return resolveTaskHostSocket(env, resolveAgentHome({ env }))
}

/**
 * Whether `hostSocket` (a host's own `host_socket`, which senpi realpath-canonicalizes) is the host `thread_create`
 * opens sessions on: the operator daemon a woken session is opened on.
 */
export function isThreadSocket(
  hostSocket: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return canonicalSocket(hostSocket) === canonicalSocket(resolveThreadSocket(env))
}

function canonicalSocket(path: string): string {
  try {
    return join(realpathSync(dirname(path)), basename(path))
  } catch {
    return path
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string {
  return resolveProjectStateDirectory(pi.cwd ?? process.cwd(), "thread-tools")
}
