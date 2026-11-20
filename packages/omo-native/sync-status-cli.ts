import { stat } from "node:fs/promises"

import { isDeviceSyncOff } from "../memory-core/src/sync/account/device-switch.ts"
import { trustAnchorDir } from "../memory-core/src/sync/device-retire.ts"
import type { SyncContext } from "./sync-context"
import type { EngineSyncRead } from "./sync-engine-status"

// `omo sync status` (#14435): a read-only report of this device's memory sync. It reads the signed-in context, the
// local pin and switch, the account's devices and pending joins, and whether an engine runs; it writes nothing, and
// every field is an id, a flag, a time or a count, never key material. Each section reports its own failure.

type Section<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string }

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
  readonly deviceId: string
  readonly device: Section<{ readonly joined: boolean; readonly switch: "on" | "off" }>
  readonly devices: Section<{ readonly list: readonly StatusDevice[] }>
  readonly pending: Section<{
    readonly list: ReadonlyArray<{ readonly id: string; readonly expiresAt: string; readonly answered: boolean }>
  }>
  readonly engine: EngineSyncRead
}

const failed = (error: unknown): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason: error instanceof Error ? error.message : "the read failed",
})

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      throw error
    },
  )

async function readDevice(context: SyncContext): Promise<SyncStatusReport["device"]> {
  try {
    const [joined, off] = await Promise.all([
      exists(trustAnchorDir(context.pinDir, context.account)),
      isDeviceSyncOff(context.pinDir, context.account),
    ])
    return { ok: true, joined, switch: off ? "off" : "on" }
  } catch (error) {
    return failed(error)
  }
}

async function readDevices(context: SyncContext): Promise<SyncStatusReport["devices"]> {
  if (context.listDevices === undefined) return { ok: false, reason: "this sign-in cannot list devices" }
  try {
    const list = (await context.listDevices()).map((device) => ({
      id: device.id,
      name: device.name,
      ...(device.syncing === undefined ? {} : { syncing: device.syncing }),
      ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
      current: device.current === true || device.id === context.serviceDeviceId,
    }))
    return { ok: true, list }
  } catch (error) {
    return failed(error)
  }
}

async function readPending(context: SyncContext): Promise<SyncStatusReport["pending"]> {
  try {
    const list = (await context.pairing.listPending()).map((row) => ({
      id: row.id,
      expiresAt: new Date(row.expires_at).toISOString(),
      answered: row.answer !== null,
    }))
    return { ok: true, list }
  } catch (error) {
    return failed(error)
  }
}

export async function collectSyncStatus(
  context: SyncContext,
  engine: () => Promise<EngineSyncRead>,
): Promise<SyncStatusReport> {
  const [device, devices, pending, engineRead] = await Promise.all([
    readDevice(context),
    readDevices(context),
    readPending(context),
    engine(),
  ])
  return { account: context.account, deviceId: context.serviceDeviceId, device, devices, pending, engine: engineRead }
}

function engineLine(engine: EngineSyncRead): string {
  switch (engine.kind) {
    case "no_engine":
      return "Engine: no engine is running on this machine."
    case "running":
      return "Engine: running. Its memory sync details are not readable from the CLI yet (see code-yeongyu/senpi#7107); the TUI footer and the desktop app show them."
    case "unreadable":
      return `Engine: could not be checked (${engine.reason}).`
  }
}

export function syncStatusLines(report: SyncStatusReport): string[] {
  const lines = [
    `Account: ${report.account}`,
    report.device.ok
      ? `This device: ${report.deviceId}, ${report.device.joined ? "joined" : "not joined"}, sync ${report.device.switch}`
      : `This device: ${report.deviceId}, local sync state could not be read (${report.device.reason}).`,
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
  lines.push(engineLine(report.engine))
  return lines
}
