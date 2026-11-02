import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/**
 * Read-only mirror of senpi's endpoint registry (`<agentDir>/rpc-host-daemon/<16hex>/endpoint.json`,
 * `modes/rpc/host-endpoints.ts`). Every endpoint an agent directory holds - multi-session hosts,
 * their `p-*`/`i-*` shards, and the control endpoints of terminals running the OmO extension - is
 * one directory there, named by the canonical socket it serves. Nothing here writes, unlinks or
 * connects; the engine's `host status --all` stays the primary enumeration, and this reader is what
 * classifies a socket's kind and what enumerates when the engine cannot.
 */

export type EndpointKind = "rpc_host" | "tui"

export type EndpointIdentitySource = "endpoint" | "settings" | "generation-settings" | "unknown"

export type RegistryEndpoint = {
  /** The socket the directory serves, or `null` when nothing in it names one that hashes to it. */
  readonly socket: string | null
  readonly dir: string
  readonly identity: EndpointIdentitySource
  readonly endpoint_kind: EndpointKind
  /** `registry_version` of `endpoint.json`; `null` for a record written before the field existed. */
  readonly registry_version: number | null
}

/** Only this layout writes `endpoint.json`; an agent dir without its marker has no registry. */
export const ENDPOINT_REGISTRY_LAYOUT = 2

const ENDPOINT_DIRECTORY_NAME = /^[0-9a-f]{16}$/
const TUI_SOCKET_NAME = /^t-[0-9a-f]{16}\.sock$/

/** A terminal control socket's name (`t-<sha256(instanceId)[:16]>.sock`), which alone says no host serves it. */
export function isTuiControlSocket(socket: string): boolean {
  return TUI_SOCKET_NAME.test(basename(socket))
}

/**
 * The secret a terminal control endpoint authenticates every connection with: 32 bytes in
 * `<socket>.secret`, sent before the first request.
 */
export function controlSocketSecretPath(socket: string): string {
  return `${socket}.secret`
}

/** senpi `canonicalEndpointPath` on POSIX: the socket's directory resolved through its deepest existing ancestor. */
export function canonicalEndpointPath(socket: string): string {
  if (socket.startsWith("\0")) return socket
  return join(canonicalDirectory(dirname(socket)), basename(socket))
}

function canonicalDirectory(directory: string): string {
  const missing: string[] = []
  let current = directory
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return directory
      missing.push(basename(current))
      current = parent
    }
  }
}

function hashName(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex").slice(0, 16)
}

/** Whether a record naming `socket` belongs in the directory called `name` (canonical or as-spelled hash). */
export function socketNamesDirectory(socket: string, name: string): boolean {
  return hashName(canonicalEndpointPath(socket)) === name || hashName(socket) === name
}

type JsonRecord = Record<string, unknown>

async function readRecord(file: string): Promise<JsonRecord | undefined> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonRecord) : undefined
  } catch {
    return undefined
  }
}

async function recordNaming(file: string, dir: string): Promise<{ readonly socket: string; readonly record: JsonRecord } | undefined> {
  const record = await readRecord(file)
  const socket = record?.socket
  if (record === undefined || typeof socket !== "string" || socket === "") return undefined
  return socketNamesDirectory(socket, basename(dir)) ? { socket, record } : undefined
}

async function identify(dir: string): Promise<RegistryEndpoint> {
  const named = await recordNaming(join(dir, "endpoint.json"), dir)
  if (named !== undefined) {
    return {
      socket: named.socket,
      dir,
      identity: "endpoint",
      endpoint_kind: named.record.endpoint_kind === "tui" ? "tui" : "rpc_host",
      registry_version: typeof named.record.registry_version === "number" ? named.record.registry_version : null,
    }
  }
  const booted = await recordNaming(join(dir, "settings.json"), dir)
  if (booted !== undefined) return { socket: booted.socket, dir, identity: "settings", endpoint_kind: "rpc_host", registry_version: null }
  const generations = await readdir(join(dir, "generations")).catch(() => [] as string[])
  for (const instanceId of generations.sort()) {
    const recorded = await recordNaming(join(dir, "generations", instanceId, "settings.json"), dir)
    if (recorded !== undefined) return { socket: recorded.socket, dir, identity: "generation-settings", endpoint_kind: "rpc_host", registry_version: null }
  }
  return { socket: null, dir, identity: "unknown", endpoint_kind: "rpc_host", registry_version: null }
}

/** Every endpoint directory under `agentDir`, sorted by directory name; `[]` before layout 2. */
export async function listRegistryEndpoints(agentDir: string): Promise<readonly RegistryEndpoint[]> {
  const flatDir = join(agentDir, "rpc-host-daemon")
  const marker = await readRecord(join(flatDir, "layout.json"))
  if (marker?.layout !== ENDPOINT_REGISTRY_LAYOUT) return []
  const entries = await readdir(flatDir, { withFileTypes: true }).catch(() => [])
  const dirs = entries
    .filter((entry) => entry.isDirectory() && ENDPOINT_DIRECTORY_NAME.test(entry.name))
    .map((entry) => join(flatDir, entry.name))
    .sort()
  return await Promise.all(dirs.map((dir) => identify(dir)))
}

/**
 * The kind of `socket` from what the registry and the socket's name say, contacting nothing:
 * `tui` for a terminal control socket's name or a registry record of kind `tui`, else `rpc_host`.
 */
export function endpointKindOf(socket: string, registry: readonly RegistryEndpoint[]): EndpointKind {
  if (isTuiControlSocket(socket)) return "tui"
  const canonical = canonicalEndpointPath(socket)
  const recorded = registry.find((entry) => entry.socket !== null && (entry.socket === socket || canonicalEndpointPath(entry.socket) === canonical))
  return recorded?.endpoint_kind ?? "rpc_host"
}
