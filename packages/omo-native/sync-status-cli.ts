import { stat } from "node:fs/promises"

import { z } from "zod"

import { isDeviceSyncOff } from "../memory-core/src/sync/account/device-switch.ts"
import { trustAnchorDir } from "../memory-core/src/sync/device-retire.ts"
import type { SyncContext } from "./sync-context"
import type { EngineSync, EngineSyncRead } from "./sync-engine-status"

// `omo sync status` (#14435): a read-only report of this device's memory sync. It reads the signed-in context, the
// local pin and switch, the account's devices and pending joins, and the running engine; it writes nothing and every
// field is an id, a flag, a time or a count, never key material.

const devicesSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      syncing: z.boolean().optional(),
      lastSeenAt: z.string().optional(),
      current: z.boolean().optional(),
      revokedAt: z.string().nullable(),
    }),
  ),
})

export interface StatusDevice {
  readonly id: string
  readonly name: string
  /** Absent when the service is older than the field. */
  readonly syncing?: boolean
  readonly lastSeenAt?: string
  readonly current: boolean
}

export interface SyncStatusReport {
  readonly account: string
  readonly device: { readonly id: string; readonly joined: boolean; readonly switch: "on" | "off" }
  readonly devices:
    { readonly ok: true; readonly list: readonly StatusDevice[] } | { readonly ok: false; readonly reason: string }
  readonly pending:
    | {
        readonly ok: true
        readonly list: ReadonlyArray<{
          readonly id: string
          readonly expiresAt: string
          readonly answered: boolean
        }>
      }
    | { readonly ok: false; readonly reason: string }
  readonly engine: EngineSyncRead
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : "the request failed")

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      throw error
    },
  )

async function readDevices(context: SyncContext): Promise<SyncStatusReport["devices"]> {
  if (context.listDevices === undefined) return { ok: false, reason: "this sign-in cannot list devices" }
  try {
    const parsed = devicesSchema.safeParse(await context.listDevices())
    if (!parsed.success) return { ok: false, reason: "the service's device list did not match the expected shape" }
    const list = parsed.data.devices
      .filter((device) => device.revokedAt === null)
      .map((device) => ({
        id: device.id,
        name: device.name,
        ...(device.syncing === undefined ? {} : { syncing: device.syncing }),
        ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
        current: device.current === true || device.id === context.serviceDeviceId,
      }))
    return { ok: true, list }
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
}

async function readPending(context: SyncContext): Promise<SyncStatusReport["pending"]> {
  try {
    const rows = await context.pairing.listPending()
    const list = rows.map((row) => ({
      id: row.id,
      expiresAt: new Date(row.expires_at).toISOString(),
      answered: row.answer !== null,
    }))
    return { ok: true, list }
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
}

export async function collectSyncStatus(
  context: SyncContext,
  engine: () => Promise<EngineSyncRead>,
): Promise<SyncStatusReport> {
  const [joined, off, devices, pending, engineRead] = await Promise.all([
    exists(trustAnchorDir(context.pinDir, context.account)),
    isDeviceSyncOff(context.pinDir, context.account),
    readDevices(context),
    readPending(context),
    engine(),
  ])
  return {
    account: context.account,
    device: { id: context.serviceDeviceId, joined, switch: off ? "off" : "on" },
    devices,
    pending,
    engine: engineRead,
  }
}

function engineSyncLines(sync: EngineSync): string[] {
  const lines = [`  state: ${sync.state}`]
  if (sync.lastSyncedAtISO !== undefined) lines.push(`  last synced: ${sync.lastSyncedAtISO}`)
  if (sync.appliedWhileOffline !== undefined)
    lines.push(`  updated after the last offline gap: ${sync.appliedWhileOffline}`)
  if (sync.failure !== undefined) {
    lines.push(`  reason: ${sync.failure.reason}`)
    lines.push(`  since: ${sync.failure.sinceISO} (${sync.failure.attempts} attempts)`)
    if (sync.failure.keys !== undefined && sync.failure.keys.length > 0)
      lines.push(`  held files: ${sync.failure.keys.join(", ")}`)
  }
  return lines
}

function engineLines(engine: EngineSyncRead): string[] {
  switch (engine.kind) {
    case "no_engine":
      return ["Engine: no engine is running on this machine."]
    case "no_session":
      return ["Engine: running, but it has no open session to read sync status from."]
    case "unreadable":
      return [`Engine: could not be read (${engine.reason}).`]
    case "read":
      return engine.sync === null
        ? ["Engine: running; it does not sync this account's memory."]
        : ["Engine:", ...engineSyncLines(engine.sync)]
  }
}

export function syncStatusLines(report: SyncStatusReport): string[] {
  const lines = [
    `Account: ${report.account}`,
    `This device: ${report.device.id}, ${report.device.joined ? "joined" : "not joined"}, sync ${report.device.switch}`,
  ]
  if (report.devices.ok) {
    lines.push("Devices:")
    for (const device of report.devices.list) {
      const membership = device.syncing === undefined ? "sync unknown" : device.syncing ? "syncing" : "not syncing"
      const seen = device.lastSeenAt === undefined ? "" : `, last seen ${device.lastSeenAt}`
      lines.push(`  ${device.current ? "* " : "  "}${device.name} (${device.id}): ${membership}${seen}`)
    }
  } else lines.push(`Devices: could not be read (${report.devices.reason}).`)
  if (!report.pending.ok) lines.push(`Pending join requests: could not be read (${report.pending.reason}).`)
  else if (report.pending.list.length === 0) lines.push("Pending join requests: none")
  else {
    lines.push("Pending join requests:")
    for (const row of report.pending.list)
      lines.push(`  ${row.id}: expires ${row.expiresAt}${row.answered ? ", answered" : ", waiting"}`)
  }
  lines.push(...engineLines(report.engine))
  return lines
}
