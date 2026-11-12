import type { CommandRpc } from "./protocol.ts"
import type { DelegatedRoute } from "./protocol-delegated.ts"

/** omo#13037 A6: the sender understands the wake answer; the service copies it only toward a device listing the feature. */
export type WakeAccepts = readonly "session-wake:v1"[]

// session.command and its upload parts (docs/local-api.md "Commands"): one engine RPC record, inline or uploaded.
export type SessionCommand = (
  | {
      // omo#13037: a session of `device` that no listing maps, by its durable id; an admit_external_message record only.
      readonly id: string
      readonly type: "session.command"
      readonly wake: { readonly device: string; readonly durable_id: string }
      readonly command_id?: string
      readonly rpc: CommandRpc
    }
  | {
      // #393: the attach-less endpoint command names the host device and one of its engine endpoint keys.
      readonly id: string
      readonly type: "session.command"
      readonly device: string
      readonly endpoint: string
      readonly command_id?: string
      /** Decision 0018 amendment 2026-11-06: an open asks for its new session's `located` pair on the reply. */
      readonly locate?: true
      readonly rpc: CommandRpc
    }
  | {
      readonly id: string
      readonly type: "session.command"
      readonly attach: string
      readonly command_id?: string
      readonly accepts?: WakeAccepts
      readonly rpc: CommandRpc
    }
  | {
      readonly id: string
      readonly type: "session.command"
      readonly attach: string
      readonly command_id?: string
      readonly accepts?: WakeAccepts
      readonly upload_id: string
    }
) &
  DelegatedRoute
export type SessionCommandPart = {
  readonly id: string
  readonly type: "session.command_part"
  readonly attach: string
  readonly upload_id: string
  readonly index: number
  readonly count: number
  readonly b: string
}
