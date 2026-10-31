// Untrusted reply validators for the desktop private sync channel (desktop #5183 shared/desktopSyncPortSchema.ts).
// Chain parsing is not cryptographic verification; memory-core still verifies every record.
import { z } from "zod"

export const SyncInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const SyncPrincipal = z.object({
  kind: z.literal("device"),
  id: z.string(),
  signing_public_key: z.string(),
  sealing_public_key: z.string(),
})
const author = z.union([SyncPrincipal, z.object({ kind: z.literal("recovery"), credential_id: z.string() })])
const SyncWrap = z.object({ epoch: SyncInteger, id: z.string(), wrap: z.string() })
const chainRowFields = {
  seq: SyncInteger,
  base_seq: SyncInteger,
  kind: z.enum(["batch", "keyring"]),
  account: z.string(),
  epoch: SyncInteger,
  author,
  digest: z.string(),
  link: z.string(),
  keyring_link: z.string().nullable(),
  record_sig: z.string(),
}
const SyncChainRow = z.object(chainRowFields)
const keyringRow = z.object({
  ...chainRowFields,
  kind: z.literal("keyring"),
  keyring_link: z.string(),
  body: z.record(z.string(), z.json()),
  wraps: z.array(SyncWrap),
})
const bodyFields = z.object({ kind: z.string(), account: z.string(), epoch: SyncInteger })
export const decodeSyncKeys = (input: unknown) =>
  z.object({ entries: z.array(keyringRow) }).parse(input).entries.map(entry => ({
    ...entry,
    body: { ...entry.body, ...bodyFields.parse(entry.body) },
  }))
export const decodeSyncEntries = (input: unknown) => z.object({ entries: z.array(SyncChainRow) }).parse(input)
export const decodeRecoveryWraps = (input: unknown) => z.object({
  wraps: z.array(z.object({
    record: z.object({ seq: SyncInteger, digest: z.string(), keyring_link: z.string() }),
    entry: SyncWrap,
  })),
}).parse(input)
export const SyncPending = z.object({
  id: z.string(),
  account: z.string(),
  commitment: z.string(),
  answer: z.object({ principal: SyncPrincipal, approver_nonce: z.string() }).nullable().optional(),
  reveal: z.object({ principal: SyncPrincipal, joining_nonce: z.string() }).nullable().optional(),
  expires_at: SyncInteger,
})
export const decodeSyncPending = (input: unknown) => {
  const pending = SyncPending.parse(input)
  return { ...pending, answer: pending.answer ?? null, reveal: pending.reveal ?? null }
}
export const SyncDescriptor = z.object({
  genesis: z.enum(["supported", "unsupported"]),
  rpId: z.string().nullable(),
  userName: z.string().nullable(),
  serviceOrigin: z.string(),
  accountId: z.string(),
  serviceDeviceId: z.string(),
  syncPrincipalId: z.string(),
  generation: z.string(),
  incarnation: z.string(),
  publicKeys: z.object({ signing: z.string(), sealing: z.string() }),
})
export type SyncDescriptor = z.infer<typeof SyncDescriptor>
export const SyncDevices = z.object({
  devices: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["desktop", "cli"]),
    platform: z.enum(["macos", "linux", "windows"]),
    createdAt: z.string(),
    lastSeenAt: z.string(),
    approximateLocation: z.string().optional(),
    current: z.boolean(),
    syncing: z.boolean(),
    revokedAt: z.string().nullable(),
    syncPrincipal: z.string().nullable(),
  })),
})
const reply = z.union([
  z.strictObject({ kind: z.literal("json"), status: SyncInteger, body: z.unknown() }),
  z.strictObject({ kind: z.literal("bytes"), status: SyncInteger, bytes: z.instanceof(Uint8Array) }),
])

export class DesktopSyncServiceError extends Error {
  override readonly name = "DesktopSyncServiceError"
  readonly code: string
  readonly status: number
  constructor(code: string, status: number) {
    super(`Desktop sync service refused the request (${status}).`)
    this.code = code
    this.status = status
  }
}
const errorCode = z.object({ error: z.object({ code: z.string() }) })
export function requireSyncSuccess(input: unknown) {
  const response = reply.parse(input)
  if (response.status < 200 || response.status >= 300) {
    const parsed = response.kind === "json" ? errorCode.safeParse(response.body) : undefined
    const code = parsed?.success === true ? parsed.data.error.code : "unknown"
    throw new DesktopSyncServiceError(response.status >= 500 ? "unavailable" : code, response.status)
  }
  return response
}
export function syncJson(input: unknown): unknown {
  const response = requireSyncSuccess(input)
  if (response.kind !== "json") throw new DesktopSyncServiceError("malformed_reply", response.status)
  return response.body
}
