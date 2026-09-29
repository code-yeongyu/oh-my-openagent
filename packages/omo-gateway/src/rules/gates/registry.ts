// Every GateId has exactly one implementation (R5): `satisfies Record<GateId, AnyGate>` fails the
// typecheck when a gate id has no module, and src/rules/gates/implemented.test.ts checks the files.

import type { GateId } from "../gates"
import { gate as language } from "./language"
import { gate as link_label } from "./link_label"
import { gate as mention_requester } from "./mention_requester"
import { gate as status_sync } from "./status_sync"
import { gate as progress_edit } from "./progress_edit"
import { gate as typing_while_writing } from "./typing_while_writing"
import { gate as image_viewport } from "./image_viewport"
import { gate as bot_ignore } from "./bot_ignore"
import { gate as one_request_one_thread } from "./one_request_one_thread"
import { gate as work_item_header } from "./work_item_header"
import { gate as numbered_options } from "./numbered_options"
import { gate as decision_nag } from "./decision_nag"
import { gate as topic_scope } from "./topic_scope"
import { gate as reply_language_follows_user } from "./reply_language_follows_user"
import { gate as session_unit } from "./session_unit"
import type { AnyGate, InboundGate, OutboundGate, RouterGate } from "./types"

export const GATES = {
  language,
  link_label,
  mention_requester,
  status_sync,
  progress_edit,
  typing_while_writing,
  image_viewport,
  bot_ignore,
  one_request_one_thread,
  work_item_header,
  numbered_options,
  decision_nag,
  topic_scope,
  reply_language_follows_user,
  session_unit,
} as const satisfies Record<GateId, AnyGate>

export function gateFor(id: GateId): AnyGate {
  return GATES[id]
}

export function isOutboundGate(gate: AnyGate): gate is OutboundGate {
  return gate.phase === "outbound"
}

export function isInboundGate(gate: AnyGate): gate is InboundGate {
  return gate.phase === "inbound"
}

export function isRouterGate(gate: AnyGate): gate is RouterGate {
  return gate.phase === "router"
}
