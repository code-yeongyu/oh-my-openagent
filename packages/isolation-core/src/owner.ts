import { randomUUID } from "node:crypto"
import { readFile, rename, stat, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { basename, join } from "node:path"
import { getProcessStartIdentity } from "./process-identity"

export const OWNER_FILE = ".omo-isolation-owner.json"
export type OwnerStatus = "alive" | "dead" | "unknown"
export type OwnerLiveness = "live" | "dead" | "reclaimable" | "foreign" | "retained" | "creating" | "unknown"
export interface OwnerProbe {
  pidAlive(pid: number, startIdentity: string | null): OwnerStatus | Promise<OwnerStatus>
  hostSessionAlive?(socket: string, sessionPath: string): Promise<OwnerStatus>
}
export interface IsolationOwner {
  readonly host: { readonly pid: number }
  readonly child?: { readonly kind: "process"; readonly pid: number }
    | { readonly kind: "host-session"; readonly socket: string; readonly session_path: string }
}
interface ProcessOwner {
  readonly pid: number
  readonly start_identity: string | null
}
interface OwnerMarker {
  readonly id: string
  readonly hostname: string
  readonly created_at: number
  readonly host: ProcessOwner
  readonly child?: (ProcessOwner & { readonly kind: "process" })
    | { readonly kind: "host-session"; readonly socket: string; readonly session_path: string }
}

export async function writeOwnerMarker(
  baseDir: string,
  id: string,
  owner: IsolationOwner = { host: { pid: process.pid } },
  readIdentity: (pid: number) => Promise<string | null> = getProcessStartIdentity,
): Promise<void> {
  const host = { pid: owner.host.pid, start_identity: await readIdentity(owner.host.pid) }
  let child: OwnerMarker["child"]
  if (owner.child?.kind === "process") {
    child = { kind: "process", pid: owner.child.pid, start_identity: await readIdentity(owner.child.pid) }
  } else {
    child = owner.child
  }
  const marker: OwnerMarker = {
    id, hostname: hostname(), created_at: Date.now(), host, ...(child ? { child } : {}),
  }
  const temporary = join(baseDir, `${OWNER_FILE}.${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(marker), { mode: 0o600, flag: "wx" })
  await rename(temporary, join(baseDir, OWNER_FILE))
}

function isProcessOwner(value: unknown): value is ProcessOwner {
  return typeof value === "object" && value !== null && "pid" in value
    && typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0
    && "start_identity" in value && (value.start_identity === null || typeof value.start_identity === "string")
}
function isOwnerMarker(value: unknown): value is OwnerMarker {
  if (typeof value !== "object" || value === null
    || !("id" in value) || typeof value.id !== "string"
    || !("hostname" in value) || typeof value.hostname !== "string"
    || !("created_at" in value) || typeof value.created_at !== "number" || !Number.isFinite(value.created_at)
    || !("host" in value) || !isProcessOwner(value.host)) return false
  if (!("child" in value)) return true
  const child = value.child
  if (typeof child !== "object" || child === null || !("kind" in child)) return false
  switch (child.kind) {
    case "process": return isProcessOwner(child)
    case "host-session": return "socket" in child && typeof child.socket === "string"
      && "session_path" in child && typeof child.session_path === "string"
    default: return false
  }
}

export async function readOwnerLiveness(
  baseDir: string,
  probe: OwnerProbe,
  now = Date.now(),
): Promise<OwnerLiveness> {
  const name = basename(baseDir)
  if (name.includes(".retained-")) return "retained"
  let marker: unknown
  try {
    marker = JSON.parse(await readFile(join(baseDir, OWNER_FILE), "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) marker = null
    else if (error instanceof Error && "code" in error && error.code === "ENOENT") marker = null
    else if (error instanceof Error && "code" in error
      && (error.code === "EACCES" || error.code === "EPERM")) return "unknown"
    else throw error
  }
  if (typeof marker === "object" && marker !== null && "hostname" in marker
    && typeof marker.hostname === "string" && marker.hostname !== hostname()) return "foreign"
  if (isOwnerMarker(marker)) {
    const states = [await probe.pidAlive(marker.host.pid, marker.host.start_identity)]
    if (marker.child) {
      switch (marker.child.kind) {
        case "process":
          states.push(await probe.pidAlive(marker.child.pid, marker.child.start_identity))
          break
        case "host-session":
          states.push(await probe.hostSessionAlive?.(marker.child.socket, marker.child.session_path) ?? "unknown")
          break
      }
    }
    if (states.includes("alive")) return name.includes(".creating-") ? "creating" : "live"
    if (states.includes("unknown")) return "unknown"
    if (!name.includes(".creating-")) return "dead"
  }
  const age = now - (await stat(baseDir)).mtimeMs
  return age > 10 * 60_000 ? "reclaimable" : "creating"
}
