import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import { opText } from "./text"
import type { GateOp, GateResult, OutboundIntent, OutboundIntentKind } from "./types"

export const THREAD: SurfaceKey = { platform: "slack", account_id: "T000TEST", chat_id: "C000WORK", thread_id: "M000ROOT" }
export const HEADER_ID = "M000ROOT"

export function post(text: string, key: SurfaceKey = THREAD): GateOp {
  return { op: "post", key, text }
}

export function edit(messageId: string, text: string, key: SurfaceKey = THREAD): GateOp {
  return { op: "edit", key, message_id: messageId, text }
}

export function intentOf(kind: OutboundIntentKind, ops: readonly GateOp[], extra: Partial<OutboundIntent> = {}): OutboundIntent {
  return { kind, key: THREAD, ops, ...extra }
}

export function reply(text: string): OutboundIntent {
  return intentOf("reply", [post(text)])
}

export function eventOf(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    event_id: "E000001",
    key: { platform: "slack", account_id: "T000TEST", chat_id: "C000WORK", thread_id: null },
    author: { platform_user_id: "U000ALICE", display: "alice", is_bot: false },
    kind: "channel",
    reaction: null,
    edited: null,
    gateway_marker: false,
    text: "please fix the login page",
    transcript: null,
    attachments: [],
    reply_to: null,
    at: "2026-09-29T00:00:00.000Z",
    permalink: "https://chat.example.test/C000WORK/p1",
    ...overrides,
  }
}

export function repaired<T>(result: GateResult<T>): T {
  if (!("repair" in result)) throw new Error(`expected a repair, got ${JSON.stringify(result)}`)
  return result.repair
}

export function repairedText(result: GateResult<OutboundIntent>, index = 0): string {
  const op = repaired(result).ops[index]
  return op === undefined ? "" : (opText(op) ?? "")
}
