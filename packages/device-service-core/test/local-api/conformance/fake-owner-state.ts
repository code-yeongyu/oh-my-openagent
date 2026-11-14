import type {
  ClientInfo,
  CommandRpc,
  ControlAttachState,
  EnforcementReport,
  ErrorCode,
  JsonObject,
  RequestType,
  Status,
} from "../../../src/local-api/protocol.ts"
import type { UploadAssembler } from "../../../src/local-api/upload.ts"
import type { FakeOwnerMode, Withheld } from "./fake-owner-modes.ts"
import type { World, WorldSession } from "./world.ts"

export type Conn = {
  readonly send: (message: unknown) => void
  readonly close: () => void
  readonly attaches: Set<string>
  readonly client: () => ClientInfo | undefined
  subscribed: boolean
}
export type OwnerState = {
  readonly stateDir: string
  readonly world: World
  status: Status
  readonly conns: Set<Conn>
  readonly log: RequestType[]
  adoptions: number
  /** Every device.adopt exactly as it arrived, before validation (the account field included when sent). */
  readonly adoptRequests: Record<string, unknown>[]
  readonly attaches: Map<string, WorldSession>
  readonly bindings: Map<string, { readonly target: string; readonly sha256: string }>
  readonly commands: CommandRpc[]
  readonly uploads: UploadAssembler
  readonly endpoints: Set<string>
  readonly reports: Omit<EnforcementReport, "id" | "type">[]
  refresher: { readonly binary_path: string; readonly version: string } | null
  attach: ControlAttachState
  readonly now: () => number
  readonly mint: () => string
  stop: () => Promise<void>
  readonly mode?: FakeOwnerMode
  /** The engine records a `terminal` owner's endpoint takes; any other is answered as an unknown command. */
  readonly terminalCommands: ReadonlySet<string>
  readonly withheld: (what: Withheld) => void
}
export type Reply =
  | { readonly data: JsonObject }
  | {
      readonly error: {
        readonly code: ErrorCode
        readonly reason: string
        readonly extra?: JsonObject
      }
    }
export type Outcome = { readonly reply: Reply; readonly after?: () => void }

export const ok = (data: JsonObject = {}, after?: () => void): Outcome =>
  after === undefined ? { reply: { data } } : { reply: { data }, after }
export const refuse = (code: ErrorCode, reason: string, extra?: JsonObject): Outcome => ({
  reply: { error: extra === undefined ? { code, reason } : { code, reason, extra } },
})
export const eventOf = (kind: string, body: JsonObject): JsonObject => ({
  type: "event",
  kind,
  ...body,
})
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
