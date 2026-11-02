import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { readSessionContext } from "./session-role"

export const HOST_SOCKET_CONTEXT = "host_socket"

/** Absent for a session that is not inside a host (a root session). */
export function readOwnHostSocket(pi: unknown): string | undefined {
  const socket = readSessionContext(pi)?.[HOST_SOCKET_CONTEXT]
  return socket === undefined || socket.length === 0 ? undefined : socket
}

/**
 * Whether `socket` is the endpoint THIS session runs behind. A pure path comparison, independent of
 * which host generation answers there: such an endpoint is never ensured from inside, because a
 * session cannot restart the host it lives in.
 */
export function isOwnEndpoint(socket: string, ownHostSocket: string | undefined): boolean {
  return ownHostSocket !== undefined && canonicalSocketPath(socket) === canonicalSocketPath(ownHostSocket)
}

/**
 * Whether this process may only ATTACH to `socket`, never ensure it. A process inside a host must
 * never start a supervisor: when its engine does not stamp `host_socket` (`ownHostSocket` unknown),
 * the inherited tree context is the only inside-host fact, and every recorded endpoint counts as its own.
 */
export function attachOnlyEndpoint(socket: string, ownHostSocket: string | undefined, insideHost: boolean): boolean {
  return ownHostSocket === undefined ? insideHost : isOwnEndpoint(socket, ownHostSocket)
}

// The rule the host stamps `host_socket` with (senpi #2245): the directory canonicalised through
// its deepest EXISTING ancestor, the missing tail re-appended verbatim, then the socket's basename -
// so a shard whose `rpc/shards/` does not exist yet still compares equal across `/tmp` spellings.
function canonicalSocketPath(socket: string): string {
  return join(canonicalDirectory(dirname(resolve(socket))), basename(socket))
}

function canonicalDirectory(directory: string): string {
  const missing: string[] = []
  let existing = directory
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) return directory
    missing.unshift(basename(existing))
    existing = parent
  }
  try {
    return join(realpathSync(existing), ...missing)
  } catch {
    return directory
  }
}
