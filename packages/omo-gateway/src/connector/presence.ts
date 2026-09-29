// The connector presence row: what a running connector reports about itself for `omo gateway
// status` and the doctor (todo 20). Until the gateway tables land in the session-gateway store
// (todo 11) the row is a JSON file beside the lock, written atomically on every state change.
// A presence file is trusted only while the lock names the same live pid; a connector killed with
// -9 leaves its file behind, and readers report it as stale instead of alive.

import { hostname } from "node:os"
import { join } from "node:path"
import { readFile, unlink } from "@oh-my-opencode/memory-core/fs"
import { connectorLockPath, connectorName, connectorsDir, readConnectorLock, writeFileAtomic, type LockProbe } from "./lock"

/** `stopped`: the platform refused the account (AdapterFatal); the connector waits for a config or credential change */
export type ConnectorState = "connecting" | "listening" | "backoff" | "stopped" | "draining"

export type ConnectorPresence = {
  platform: string
  account_id: string
  scope: string
  host: string
  pid: number
  pid_start: string | null
  mode: "live" | "shadow"
  state: ConnectorState
  started_at: string
  updated_at: string
  restarts: number
  last_catch_up_at: string | null
  last_error: string | null
}

export type ConnectorStatus =
  | { state: "absent" }
  | { state: "stale"; pid: number; presence: ConnectorPresence | null }
  | { state: "alive"; pid: number; presence: ConnectorPresence | null }

export function presencePath(agentDir: string, platform: string, account_id: string): string {
  return join(connectorsDir(agentDir), `${connectorName(platform, account_id)}.presence.json`)
}

export function initialPresence(input: {
  platform: string
  account_id: string
  scope: string
  pid_start: string | null
  mode: "live" | "shadow"
  now: Date
}): ConnectorPresence {
  const at = input.now.toISOString()
  return {
    platform: input.platform,
    account_id: input.account_id,
    scope: input.scope,
    host: hostname(),
    pid: process.pid,
    pid_start: input.pid_start,
    mode: input.mode,
    state: "connecting",
    started_at: at,
    updated_at: at,
    restarts: 0,
    last_catch_up_at: null,
    last_error: null,
  }
}

export class PresenceWriter {
  private current: ConnectorPresence
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    initial: ConnectorPresence,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.current = initial
  }

  get value(): ConnectorPresence {
    return this.current
  }

  update(change: Partial<Omit<ConnectorPresence, "platform" | "account_id" | "pid" | "started_at">>): Promise<void> {
    this.current = { ...this.current, ...change, updated_at: this.now().toISOString() }
    const snapshot = `${JSON.stringify(this.current)}\n`
    const next = this.writing.then(() => writeFileAtomic(this.path, snapshot))
    this.writing = next.catch(() => undefined)
    return next
  }

  async remove(): Promise<void> {
    await this.writing
    try {
      await unlink(this.path)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
}

async function readPresence(path: string): Promise<ConnectorPresence | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"))
    if (value === null || typeof value !== "object" || typeof Reflect.get(value, "pid") !== "number") return null
    return Object.assign(initialPresence({ platform: "", account_id: "", scope: "", pid_start: null, mode: "live", now: new Date(0) }), value)
  } catch {
    return null
  }
}

export async function readConnectorStatus(
  agentDir: string,
  platform: string,
  account_id: string,
  probe?: LockProbe,
): Promise<ConnectorStatus> {
  const lock = await readConnectorLock(connectorLockPath(agentDir, platform, account_id), probe)
  if (lock === null) return { state: "absent" }
  const presence = await readPresence(presencePath(agentDir, platform, account_id))
  const own = presence !== null && presence.pid === lock.record.pid ? presence : null
  return { state: lock.live ? "alive" : "stale", pid: lock.record.pid, presence: own }
}
