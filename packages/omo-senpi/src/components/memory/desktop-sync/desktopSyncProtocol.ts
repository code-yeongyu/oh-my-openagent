// Engine side of the desktop private sync channel envelope (desktop #5183 shared/desktopSyncProtocol.ts).
// Adopted with the same decoder semantics on omo's runtime schema library.
import { z } from "zod"

export class DesktopSyncRefused extends Error {
  override readonly name = "DesktopSyncRefused"
  constructor() {
    super("The private desktop sync channel is unavailable or retired.")
  }
}

const token = z.string().min(1).max(256)
export const DesktopSyncRequest = z.union([
  z.object({ op: z.enum(["descriptor", "operationBegin", "capability"]) }),
  z.object({ op: z.enum(["operationCancel", "operationEnd"]), handle: token }),
  z.object({ op: z.enum(["service", "keyring", "genesisRun"]), handle: token, data: z.unknown() }),
])
export type DesktopSyncRequest =
  | { readonly op: "descriptor" | "operationBegin" | "capability" }
  | { readonly op: "operationCancel" | "operationEnd"; readonly handle: string }
  | { readonly op: "service" | "keyring" | "genesisRun"; readonly handle: string; readonly data: unknown }

export const decodeSyncHandle = (input: unknown): { readonly handle: string } =>
  z.strictObject({ handle: token }).parse(input)

export const DesktopSyncEvent = z.union([
  z.strictObject({ event: z.literal("retired"), child: token }),
  z.strictObject({ event: z.literal("advanced"), child: token, handle: token, head: z.number().int().min(0) }),
  z.strictObject({ event: z.literal("connected"), child: token, handle: token, connected: z.boolean() }),
])
export type DesktopSyncEvent = z.infer<typeof DesktopSyncEvent>

export interface DesktopSyncAuthority {
  readonly signal: AbortSignal
  admit<T>(effect: () => T): T
}

export interface DesktopSyncWire {
  /** Must synchronously write to the authenticated transport before returning the Promise. */
  request(request: DesktopSyncRequest): Promise<unknown>
}
