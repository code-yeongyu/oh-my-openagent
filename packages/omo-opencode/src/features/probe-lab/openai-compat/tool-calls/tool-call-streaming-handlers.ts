import { randomBytes } from "node:crypto"
import {
  buildClosingArgsDelta,
  buildParamDelta,
  typeParameterValue,
} from "./argument-delta-builder"
import { stripFencedCode } from "./parser/fenced-code"
import { computeHorizon } from "./stream-sieve-horizon"
import {
  findEarliest,
  findFirstMatch,
  INVOKE_CLOSE_RE,
  INVOKE_OPEN_RE,
  type MatchInfo,
  PARAM_RE,
  WRAPPER_CLOSE_PATTERNS,
  WRAPPER_OPEN_PATTERNS,
} from "./tool-call-streaming-patterns"
import type {
  StateEvent,
  StreamingState,
} from "./tool-call-streaming-types"

export function processOutside(state: StreamingState): StateEvent[] {
  const buffer = state.buffer
  if (buffer.length === 0) return []
  const { clean } = stripFencedCode(buffer)
  const opener = findEarliest(clean, WRAPPER_OPEN_PATTERNS)
  if (opener === null) {
    const horizon = computeHorizon(buffer)
    if (horizon === 0) return []
    const text = buffer.slice(0, horizon)
    state.buffer = buffer.slice(horizon)
    return text.length > 0 ? [{ type: "content", text }] : []
  }
  const events: StateEvent[] = []
  if (opener.start > 0) {
    events.push({ type: "content", text: buffer.slice(0, opener.start) })
  }
  state.buffer = buffer.slice(opener.end)
  state.mode = "inside_wrapper"
  return events
}

type WrapperPick =
  | { kind: "invoke_open"; m: MatchInfo }
  | { kind: "wrapper_close"; m: MatchInfo }
  | null

function pickWrapperEvent(buffer: string): WrapperPick {
  const invokeOpen = findFirstMatch(buffer, INVOKE_OPEN_RE)
  const wrapperClose = findEarliest(buffer, WRAPPER_CLOSE_PATTERNS)
  if (invokeOpen !== null && wrapperClose !== null) {
    return invokeOpen.start <= wrapperClose.start
      ? { kind: "invoke_open", m: invokeOpen }
      : { kind: "wrapper_close", m: wrapperClose }
  }
  if (invokeOpen !== null) return { kind: "invoke_open", m: invokeOpen }
  if (wrapperClose !== null) return { kind: "wrapper_close", m: wrapperClose }
  return null
}

export function processInsideWrapper(state: StreamingState): StateEvent[] {
  if (state.buffer.length === 0) return []
  const pick = pickWrapperEvent(state.buffer)
  if (pick === null) return []
  if (pick.kind === "wrapper_close") {
    state.buffer = state.buffer.slice(pick.m.end)
    state.mode = "outside"
    return []
  }
  const name = pick.m.groups[0] ?? ""
  const idx = state.nextIndex++
  const id = `call_${randomBytes(8).toString("hex")}`
  state.current = {
    index: idx,
    id,
    name,
    startedEmitted: false,
    argsCollected: {},
  }
  state.buffer = state.buffer.slice(pick.m.end)
  state.mode = "inside_invoke"
  return []
}

type InvokePick =
  | { kind: "param"; m: MatchInfo }
  | { kind: "invoke_close"; m: MatchInfo }
  | null

function pickInvokeEvent(buffer: string): InvokePick {
  const param = findFirstMatch(buffer, PARAM_RE)
  const invokeClose = findFirstMatch(buffer, INVOKE_CLOSE_RE)
  if (param !== null && invokeClose !== null) {
    return param.start < invokeClose.start
      ? { kind: "param", m: param }
      : { kind: "invoke_close", m: invokeClose }
  }
  if (param !== null) return { kind: "param", m: param }
  if (invokeClose !== null) return { kind: "invoke_close", m: invokeClose }
  return null
}

function handleParam(state: StreamingState, m: MatchInfo): StateEvent[] {
  const cur = state.current
  if (cur === null) return []
  const paramName = m.groups[0] ?? ""
  const rawValue = m.groups[1] ?? ""
  const typed = typeParameterValue(rawValue)
  cur.argsCollected[paramName] = typed
  const isFirst = !cur.startedEmitted
  const events: StateEvent[] = []
  if (!cur.startedEmitted) {
    events.push({
      type: "tool_call_started",
      index: cur.index,
      id: cur.id,
      name: cur.name,
    })
    cur.startedEmitted = true
  }
  events.push({
    type: "tool_call_argument_delta",
    index: cur.index,
    argumentsDelta: buildParamDelta(paramName, typed, isFirst),
  })
  state.buffer = state.buffer.slice(m.end)
  return events
}

function handleInvokeClose(state: StreamingState, m: MatchInfo): StateEvent[] {
  const cur = state.current
  const events: StateEvent[] = []
  if (cur !== null && cur.startedEmitted) {
    events.push({
      type: "tool_call_argument_delta",
      index: cur.index,
      argumentsDelta: buildClosingArgsDelta(),
    })
    events.push({
      type: "tool_call_complete",
      index: cur.index,
      call: { name: cur.name, arguments: cur.argsCollected },
    })
  }
  state.current = null
  state.buffer = state.buffer.slice(m.end)
  state.mode = "inside_wrapper"
  return events
}

export function processInsideInvoke(state: StreamingState): StateEvent[] {
  if (state.current === null || state.buffer.length === 0) return []
  const pick = pickInvokeEvent(state.buffer)
  if (pick === null) return []
  if (pick.kind === "param") return handleParam(state, pick.m)
  return handleInvokeClose(state, pick.m)
}
