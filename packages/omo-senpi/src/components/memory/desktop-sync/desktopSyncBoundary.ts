import { readFile } from "@oh-my-opencode/memory-core/fs"
import { homedir } from "node:os"
import { z } from "zod"
import { credentialLockPaths, withCredentialLock } from "@oh-my-opencode/omo-opencode/service-auth"
import type { DesktopSyncDescriptor } from "@oh-my-opencode/memory-core/sync-engine"
import { DesktopSyncRefused } from "./desktopSyncProtocol"

const keys = z.strictObject({ signing: z.string(), sealing: z.string() })
const DesktopGenerationRecord = z.strictObject({
  version: z.literal(1),
  state: z.enum(["active", "transitioning", "cleared"]),
  generation: z.string().min(1),
  incarnation: z.string().min(1),
  accountId: z.string().nullable(),
  serviceDeviceId: z.string().nullable(),
  publicKeys: keys.nullable(),
})

/** Re-read main's durable record; only an active record naming the captured identity, generation and incarnation passes. */
async function desktopRecordIsCurrent(descriptor: DesktopSyncDescriptor, home = homedir()): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(credentialLockPaths(descriptor.serviceOrigin, home).desktopRecord, "utf8")
  } catch {
    return false
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return false }
  const record = DesktopGenerationRecord.safeParse(parsed)
  if (!record.success) return false
  const value = record.data
  return value.state === "active"
    && value.generation === descriptor.generation
    && value.incarnation === descriptor.incarnation
    && value.accountId === descriptor.accountId
    && value.serviceDeviceId === descriptor.serviceDeviceId
    && value.publicKeys?.signing === descriptor.publicKeys.signing
    && value.publicKeys?.sealing === descriptor.publicKeys.sealing
}

/**
 * The desktop account's pin boundary (account-transport-api v7 section 1): main's credential writers hold the same
 * per-origin lock, so the record cannot change between this read and the synchronous dispatch.
 */
export function desktopSyncBoundary(descriptor: DesktopSyncDescriptor, lifetime: AbortSignal, home = homedir()) {
  return <T>(dispatch: () => T): Promise<T> => withCredentialLock(descriptor.serviceOrigin, async () => {
    if (lifetime.aborted || !await desktopRecordIsCurrent(descriptor, home) || lifetime.aborted) throw new DesktopSyncRefused()
    return { value: dispatch() }
  }, home, "desktop-sync-boundary").then(boxed => boxed.value)
}
