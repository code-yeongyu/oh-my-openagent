// The staging shared by the foreground pointer scenarios (#9095): two pointer hosts laid out so the
// front one covers the target point, the cursor parked over the front one (the stale position), the
// target's capture frame, and the checks and JSONL line every such scenario reports. Every fact comes
// from the hosts' own event logs, the independent pointer probe and the mouse trace, never from the
// engine.
import { asObject, type Engine, errorCode, type Json, type JsonObject, type Reply } from "./engine"
import {
  hostEvents,
  inside,
  type MouseTrace,
  mouseTrace,
  type Point,
  type PointerHost,
  type PointerProbe,
  pointerHost,
  probe,
  probeHostsUntil,
  type ScreenRect,
} from "./pointer-kit"
import type { Checks, ScenarioContext, ScenarioOutcome } from "./scenario-kit"

export interface Layout {
  readonly target: ScreenRect
  readonly front: ScreenRect
  /** Where the cursor waits before the request: over the front host, away from the target point. */
  readonly stale: Point
}

/** The front host covers the target's centre and right half; the stale cursor is over the front host only. */
export const COVERED: Layout = {
  target: { left: 100, top: 100, right: 580, bottom: 460 },
  front: { left: 300, top: 240, right: 780, bottom: 600 },
  stale: { x: 700, y: 540 },
}

/** #9062's shape: both hosts on one rect, the stale cursor inside both, away from the centre. */
export const SAME_RECT: Layout = {
  target: { left: 302, top: 200, right: 722, bottom: 520 },
  front: { left: 302, top: 200, right: 722, bottom: 520 },
  stale: { x: 430, y: 326 },
}

/** A logged point may sit a few pixels off the mapped one: DWM's invisible borders widen GetWindowRect. */
export const POINT_TOLERANCE = 10

export interface Stage {
  readonly target: PointerHost
  readonly front: PointerHost
  readonly trace: MouseTrace
  readonly frame: { readonly id: string | null; readonly width: number; readonly height: number }
  readonly before: PointerProbe
}

export async function stage(context: ScenarioContext, engine: Engine, tag: string, layout: Layout): Promise<Stage> {
  await engine.activate()
  const target = await pointerHost(context, engine, `${tag}-target`, layout.target)
  const front = await pointerHost(context, engine, `${tag}-front`, layout.front)
  const captured = asObject(await engine.result("capture", { target: target.id }))
  await engine.exec("raiseWindow", { windowId: front.id })
  await probeHostsUntil([target, front], (seen) => seen.foreground === front.id)
  const before = await probe([target, front], layout.stale)
  const trace = await mouseTrace(context, tag)
  return {
    target,
    front,
    trace,
    frame: {
      id: typeof captured.frameId === "string" ? captured.frameId : null,
      width: Number(captured.width),
      height: Number(captured.height),
    },
    before,
  }
}

/** A point of the target's frame (fractions of its size) and where it lies on screen. */
export function framePoint(state: Stage, fx: number, fy: number): { readonly frame: Point; readonly screen: Point } {
  const frame = { x: Math.floor(state.frame.width * fx), y: Math.floor(state.frame.height * fy) }
  const rect = state.before.hosts[state.target.id]?.rect
  if (rect === null || rect === undefined) return { frame, screen: { x: -1, y: -1 } }
  // The frame is the window's visible bounds, centred inside GetWindowRect's invisible borders.
  const inset = Math.max(0, Math.round((rect.right - rect.left - state.frame.width) / 2))
  return { frame, screen: { x: rect.left + inset + frame.x, y: rect.top + frame.y } }
}

export function at(state: Stage, point: Point): JsonObject {
  return { target: state.target.id, x: point.x, y: point.y, frameId: state.frame.id }
}

export function stagingChecks(state: Stage, point: Point): Checks {
  const { before, front } = state
  const far = Math.abs(before.cursor.x - point.x) > POINT_TOLERANCE || Math.abs(before.cursor.y - point.y) > POINT_TOLERANCE
  return [
    ["front-raised-before", before.foreground === front.id],
    ["target-point-covered-by-front", inside(before.hosts[front.id]?.rect ?? null, point)],
    ["stale-cursor-parked-over-front", before.cursorRoot === front.id],
    ["stale-cursor-away-from-point", far],
  ]
}

export function restoreChecks(state: Stage, after: PointerProbe): Checks {
  return [
    ["front-restored", after.foreground === state.front.id],
    ["cursor-restored", after.cursor.x === state.before.cursor.x && after.cursor.y === state.before.cursor.y],
  ]
}

export async function outcome(
  state: Stage,
  checks: Checks,
  facts: JsonObject,
  after: PointerProbe,
): Promise<ScenarioOutcome> {
  await state.trace.stop()
  const failed = checks.find(([, passed]) => !passed)
  const checkFacts: JsonObject = {}
  for (const [name, passed] of checks) checkFacts[name] = passed
  const events: Json = {
    target: hostEvents(state.target),
    front: hostEvents(state.front),
    // WM_MOUSEMOVE 200, WM_LBUTTONDOWN 201, WM_LBUTTONUP 202, WM_MOUSEWHEEL 20A.
    mouseTrace: state.trace.lines().slice(-200),
  }
  return {
    pass: failed === undefined,
    ...(failed === undefined ? {} : { reason: failed[0] }),
    facts: { ...facts, target: state.target.id, front: state.front.id, events, checks: checkFacts },
    observer: { before: state.before.raw, after: after.raw },
  }
}

export function replyFacts(name: string, reply: Reply): JsonObject {
  return { [`${name}Error`]: errorCode(reply) ?? null, [`${name}Message`]: reply.error?.message ?? null }
}
