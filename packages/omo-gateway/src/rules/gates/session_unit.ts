import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import {
  isSessionUnitPlatform,
  SESSION_UNIT_DEFAULTS,
  SESSION_UNIT_OPTIONS,
  type GateParams,
  type SessionUnitPlatform,
} from "../gates"
import { GateParamsError, OK, type RouterGate } from "./types"

export interface SessionUnit {
  /** the session_unit params key that applied: the platform, or `dm` for direct messages */
  readonly surface: SessionUnitPlatform
  readonly unit: string
  /** the binding key one session owns: thread-like units keep the event's thread, others the chat */
  readonly key: SurfaceKey
  /** true when a rule override (not the default) chose the unit */
  readonly overridden: boolean
}

const CHAT_WIDE_UNITS: ReadonlySet<string> = new Set(["chat", "page", "dm"])

/**
 * What one session is for an event: the per-platform unit from the compiled `session_unit` params
 * laid over the defaults (Slack/Discord/Feishu thread, Telegram topic, Notion discussion, DMs a DM
 * thread). A thread-like unit for a top-level message (thread_id null) means the message opens a
 * new unit; a Telegram chat without topics has no thread id, so its topic unit is the chat.
 */
export function sessionUnitFor(event: Pick<InboundEvent, "key" | "kind">, params: GateParams): SessionUnit {
  const surface: SessionUnitPlatform = event.kind === "dm" ? "dm" : event.key.platform
  if (!isSessionUnitPlatform(surface)) throw new GateParamsError(`no session unit is defined for platform '${surface}'`)
  const configured = params[surface]
  const options: readonly string[] = SESSION_UNIT_OPTIONS[surface]
  if (configured !== undefined && (typeof configured !== "string" || !options.includes(configured))) {
    throw new GateParamsError(`session_unit '${surface}' must be one of ${options.join(", ")}`)
  }
  const unit = typeof configured === "string" ? configured : SESSION_UNIT_DEFAULTS[surface]
  const key = CHAT_WIDE_UNITS.has(unit) ? { ...event.key, thread_id: null } : { ...event.key }
  return { surface, unit, key, overridden: typeof configured === "string" && configured !== SESSION_UNIT_DEFAULTS[surface] }
}

export const gate: RouterGate = {
  id: "session_unit",
  phase: "router",
  run(route, params) {
    const { unit, key } = sessionUnitFor(route.event, params)
    const current = route.session_key
    if (route.unit === unit && current !== null && current.chat_id === key.chat_id && current.thread_id === key.thread_id) return OK
    return { repair: { ...route, unit, session_key: key }, note: `one session per ${unit}` }
  },
}
