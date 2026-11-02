import { createHash } from "node:crypto"
import { basename, join, win32 } from "node:path"

import { senpiCreateHostDaemonPaths } from "../../lazy/senpi-barrel"

/**
 * The endpoint's daemon directory (`<agentDir>/rpc-host-daemon/<endpoint>`) as the ENGINE names it
 * (`createHostDaemonPaths`), so a change in how senpi canonicalizes the socket cannot point a reader
 * at an empty directory. An engine without the export - or a barrel nobody loaded yet - falls back to
 * `sha256(socket)[:16]` over the case-folded normalized path on win32.
 * Every omo reader of an endpoint's daemon directory resolves it here.
 */
export function hostDaemonDir(agentDir: string, socket: string): string {
  const createHostDaemonPaths = senpiCreateHostDaemonPaths()
  if (createHostDaemonPaths !== undefined) return createHostDaemonPaths({ agentDir, socket }).dir
  return join(agentDir, "rpc-host-daemon", directoryNameOf(process.platform === "win32" ? win32.normalize(socket).toLowerCase() : socket))
}

/**
 * Whether a record naming `socket` belongs in the endpoint directory `dir`, as senpi's
 * `socketNamesDirectory` decides it: the engine's canonical name, or the name a build that hashed the
 * socket's spelling itself gave the directory (still on disk after an upgrade).
 */
export function socketNamesHostDaemonDir(agentDir: string, socket: string, dir: string): boolean {
  const name = basename(dir)
  return basename(hostDaemonDir(agentDir, socket)) === name || (process.platform !== "win32" && directoryNameOf(socket) === name)
}

function directoryNameOf(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex").slice(0, 16)
}
