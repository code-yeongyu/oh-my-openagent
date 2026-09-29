// Shared shapes for the mechanical rule gates (Design record "Mechanical gate set").
//
// Every gate is a function `(subject, params, ctx) -> {ok} | {repair, note} | {refuse}`. A gate
// never drops anything silently: it either passes the subject through, returns a repaired copy
// with a note saying what it changed, or refuses with the reason the sending session is told.
// Outbound gates see a presented intent whose ops still carry gateway body markup (rendering to
// RichBody happens after the gates); inbound gates see an InboundEvent before admission; router
// gates see the routing decision dispatch is about to make.

import type { Capabilities, ChatKind, InboundEvent, SurfaceKey, UploadFile } from "../../adapter/contract"
import type { GateId, GateParams } from "../gates"
import type { GithubTitleResolver } from "./github-titles"
import type { ImageSize } from "./image-size"

export type WorkStatus = "working" | "waiting" | "done" | "failed"

export type OutboundIntentKind = "reply" | "progress" | "status" | "question" | "file" | "header"

/** A presented platform operation; text fields are gateway body markup (`*bold*`, `<url|label>`, `<@user>`). */
export type GateOp =
  | { readonly op: "post"; readonly key: SurfaceKey; readonly text: string }
  | { readonly op: "edit"; readonly key: SurfaceKey; readonly message_id: string; readonly text: string }
  | { readonly op: "react" | "unreact"; readonly key: SurfaceKey; readonly message_id: string; readonly name: string }
  | { readonly op: "typing"; readonly key: SurfaceKey }
  | { readonly op: "upload"; readonly key: SurfaceKey; readonly files: readonly UploadFile[]; readonly comment: string | null }
  | { readonly op: "open_thread"; readonly key: SurfaceKey; readonly root: string }
  | { readonly op: "archive_thread" | "reopen_thread"; readonly key: SurfaceKey }
  | {
      readonly op: "create_chat"
      readonly key: Omit<SurfaceKey, "chat_id" | "thread_id">
      readonly name: string
      readonly kind: ChatKind
      readonly members?: readonly string[]
    }

export interface OutboundIntent {
  readonly kind: OutboundIntentKind
  readonly key: SurfaceKey
  /** the presenter's ops in send order */
  readonly ops: readonly GateOp[]
  /** the new status of a `status` intent */
  readonly status?: WorkStatus
  /** the choices of a `question` intent (empty or absent = an open question) */
  readonly options?: readonly string[]
}

export interface WorkItemContext {
  /** platform id of the work item's header (thread root) message */
  readonly header_message_id: string
  /** where the request came from, for the header's `<url|from #chat>` line */
  readonly source?: { readonly url: string; readonly chat: string } | null
  /** the current status line, used when a header is missing it */
  readonly status_line?: string | null
}

export interface OutboundGateContext {
  readonly capabilities?: Capabilities
  /** platform user id of the person the work is for */
  readonly requester?: string | null
  readonly work_item?: WorkItemContext | null
  /** the progress message already posted for this chat thread, if any */
  readonly progress_message_id?: string | null
  /** the pending decision a question intent asks: `ask` is the platform user id being asked */
  readonly decision?: { readonly ask: string } | null
  /** text of the latest human message this reply answers */
  readonly last_inbound_text?: string | null
  /** GitHub title lookup for `link_label`; defaults to a process-wide cached `gh api` resolver */
  readonly github?: GithubTitleResolver
  /** image dimension reader for `image_viewport`; defaults to reading the file header */
  readonly imageSize?: (path: string) => Promise<ImageSize | null>
}

export interface InboundGateContext {
  /** `<platform>:<platform_user_id>` entries from the scope config's `agent_accounts` */
  readonly agent_accounts?: readonly string[]
}

/** What dispatch is about to do with an inbound event (todo 14 consumes the router gates' result). */
export interface RouteIntent {
  readonly event: InboundEvent
  /** what one session is for this event (`session_unit`), null until that gate ran */
  readonly unit: string | null
  /** the binding key derived from the unit, null until `session_unit` ran */
  readonly session_key: SurfaceKey | null
  /** the event starts a new work item (`one_request_one_thread`) */
  readonly open_work_item: boolean
}

export type RouterGateContext = Record<string, never>

export type GateResult<T> =
  | { readonly ok: true }
  | { readonly repair: T; readonly note: string }
  | { readonly refuse: string }

type Awaitable<T> = T | Promise<T>

export interface OutboundGate {
  readonly id: GateId
  readonly phase: "outbound"
  run(intent: OutboundIntent, params: GateParams, ctx: OutboundGateContext): Awaitable<GateResult<OutboundIntent>>
}

export interface InboundGate {
  readonly id: GateId
  readonly phase: "inbound"
  run(event: InboundEvent, params: GateParams, ctx: InboundGateContext): Awaitable<GateResult<InboundEvent>>
}

export interface RouterGate {
  readonly id: GateId
  readonly phase: "router"
  run(route: RouteIntent, params: GateParams, ctx: RouterGateContext): Awaitable<GateResult<RouteIntent>>
}

export type AnyGate = OutboundGate | InboundGate | RouterGate

export const OK: GateResult<never> = { ok: true }

/** Thrown by a gate whose params cannot be used; the pipeline turns it into a refusal. */
export class GateParamsError extends Error {
  override readonly name = "GateParamsError"
}

export function stringListParam(params: GateParams, key: string, fallback: readonly string[]): readonly string[] {
  const value = params[key]
  if (value === undefined || value === null) return fallback
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new GateParamsError(`params.${key} must be a list of strings`)
  }
  return value
}

export function booleanParam(params: GateParams, key: string, fallback: boolean): boolean {
  const value = params[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== "boolean") throw new GateParamsError(`params.${key} must be true or false`)
  return value
}

export function positiveNumberParam(params: GateParams, key: string, fallback: number): number {
  const value = params[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new GateParamsError(`params.${key} must be a positive number`)
  }
  return value
}

export function optionalStringParam(params: GateParams, key: string): string | null {
  const value = params[key]
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new GateParamsError(`params.${key} must be a string`)
  return value
}

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(s|m|h)$/
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const

/** A duration param such as "30m", "4h" or "90s". */
export function durationParam(params: GateParams, key: string, fallback: string): number {
  const raw = params[key] ?? fallback
  const match = typeof raw === "string" ? DURATION_RE.exec(raw.trim()) : null
  const unit = match?.[2]
  if (match === null || (unit !== "s" && unit !== "m" && unit !== "h")) {
    throw new GateParamsError(`params.${key} must be a duration like 30m, 4h or 90s`)
  }
  const ms = Number(match[1]) * UNIT_MS[unit]
  if (ms <= 0) throw new GateParamsError(`params.${key} must be longer than zero`)
  return ms
}

export function sameKey(left: Pick<SurfaceKey, "chat_id" | "thread_id">, right: Pick<SurfaceKey, "chat_id" | "thread_id">): boolean {
  return left.chat_id === right.chat_id && left.thread_id === right.thread_id
}
