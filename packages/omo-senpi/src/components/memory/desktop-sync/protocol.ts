import { z } from "zod"

const token = z.string().min(1).max(256)
const id = z.number().int().min(1).max(0x7fffffff)

export const desktopSyncRequest = z.union([
  z.object({ op: z.enum(["descriptor", "operationBegin", "capability"]) }).strict(),
  z.object({ op: z.enum(["operationCancel", "operationEnd"]), handle: token }).strict(),
  z.object({ op: z.enum(["service", "keyring", "genesisRun"]), handle: token, data: z.unknown() }).strict(),
])
export type DesktopSyncRequest = z.infer<typeof desktopSyncRequest>

export const desktopSyncEvent = z.union([
  z.object({ event: z.literal("retired"), child: token }).strict(),
  z.object({ event: z.literal("advanced"), child: token, handle: token, head: z.number().int().nonnegative() }).strict(),
  z.object({ event: z.literal("connected"), child: token, handle: token, connected: z.boolean() }).strict(),
])
export type DesktopSyncEvent = z.infer<typeof desktopSyncEvent>

export const desktopSyncReply = z.discriminatedUnion("ok", [
  z.object({ id, ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ id, ok: z.literal(false), reason: z.literal("refused") }).strict(),
])
export const desktopSyncChild = z.object({ child: token }).strict()

export class DesktopSyncUnavailable extends Error {
  override readonly name = "DesktopSyncUnavailable"
  constructor() { super("The private desktop sync channel is unavailable or retired.") }
}
