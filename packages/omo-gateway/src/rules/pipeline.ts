// Runs the mechanical rule gates (Design record "Outbound pipeline" / "Inbound pipeline").
//
// Outbound: every gate in force runs in the Design record order (GATE_IDS order); a refusal stops
// the send, a repair replaces the intent and the pass repeats until no gate changes anything, so
// text a later gate adds (a GitHub title, numbered options) is checked by the earlier gates too.
// A gate that throws, returns a malformed result, or drops text becomes a refusal: nothing is
// ever sent past a gate that did not say ok or repair.

import type { InboundEvent } from "../adapter/contract"
import { GATE_IDS, SESSION_UNIT_DEFAULTS, type GateId, type GateParams } from "./gates"
import { GATES, gateFor, isInboundGate, isOutboundGate, isRouterGate } from "./gates/registry"
import { opText } from "./gates/text"
import type {
  AnyGate,
  GateResult,
  InboundGateContext,
  OutboundGateContext,
  OutboundIntent,
  RouteIntent,
  RouterGateContext,
} from "./gates/types"

export type GatesInForce = Readonly<Partial<Record<GateId, GateParams>>>

/** The gate module behind each id; the registry by default. */
export type GateImplementations = Readonly<Record<GateId, AnyGate>>

export interface GateRepair {
  readonly gate: GateId
  readonly note: string
}

export type PipelineResult<T> =
  | { readonly verdict: "ok" | "repaired"; readonly value: T; readonly repairs: readonly GateRepair[] }
  | { readonly verdict: "refused"; readonly gate: GateId; readonly reason: string; readonly repairs: readonly GateRepair[] }

const MAX_PASSES = 3
const INBOUND_ORDER = GATE_IDS.filter((id) => isInboundGate(gateFor(id)))
const ROUTER_ORDER = GATE_IDS.filter((id) => isRouterGate(gateFor(id)))

// Gates the pipeline runs even without a rule: the loop guard and the session unit.
const ALWAYS_ON: Readonly<Partial<Record<GateId, GateParams>>> = { bot_ignore: {}, session_unit: SESSION_UNIT_DEFAULTS }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function checkResult<T>(id: GateId, result: unknown): GateResult<T> {
  if (typeof result === "object" && result !== null) {
    if (Reflect.get(result, "ok") === true) return { ok: true }
    const refuse: unknown = Reflect.get(result, "refuse")
    if (typeof refuse === "string" && refuse.length > 0) return { refuse }
    const note: unknown = Reflect.get(result, "note")
    if (Reflect.has(result, "repair") && typeof note === "string") return { repair: Reflect.get(result, "repair"), note }
  }
  return { refuse: `gate ${id} returned no verdict` }
}

function droppedText(before: OutboundIntent, after: OutboundIntent): boolean {
  const texts = (intent: OutboundIntent) => intent.ops.map(opText).filter((text): text is string => text !== null)
  const was = texts(before)
  const now = texts(after)
  return now.length < was.length || (was.some((text) => text.trim() !== "") && now.every((text) => text.trim() === ""))
}

async function runOne<T>(id: GateId, run: () => unknown): Promise<GateResult<T>> {
  try {
    return checkResult<T>(id, await run())
  } catch (error) {
    return { refuse: `gate ${id} could not check this message: ${describe(error)}` }
  }
}

async function settle<T>(
  order: readonly GateId[],
  gates: GatesInForce,
  start: T,
  run: (id: GateId, value: T, params: GateParams) => unknown,
  guard: (id: GateId, before: T, after: T) => string | null,
): Promise<PipelineResult<T>> {
  let value = start
  const repairs: GateRepair[] = []
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false
    for (const id of order) {
      const params = gates[id] ?? ALWAYS_ON[id]
      if (params === undefined) continue
      const result = await runOne<T>(id, () => run(id, value, params))
      if ("refuse" in result) return { verdict: "refused", gate: id, reason: result.refuse, repairs }
      if (!("repair" in result)) continue
      const broken = guard(id, value, result.repair)
      if (broken !== null) return { verdict: "refused", gate: id, reason: broken, repairs }
      value = result.repair
      repairs.push({ gate: id, note: result.note })
      changed = true
    }
    if (!changed) return { verdict: repairs.length === 0 ? "ok" : "repaired", value, repairs }
  }
  const last = repairs.at(-1)?.gate ?? order[0] ?? "language"
  return { verdict: "refused", gate: last, reason: `the rule gates did not settle after ${MAX_PASSES} passes`, repairs }
}

export function runOutboundGates(
  intent: OutboundIntent,
  gates: GatesInForce,
  ctx: OutboundGateContext = {},
  implementations: GateImplementations = GATES,
): Promise<PipelineResult<OutboundIntent>> {
  return settle(
    GATE_IDS.filter((id) => isOutboundGate(implementations[id])),
    gates,
    intent,
    (id, value, params) => {
      const gate = implementations[id]
      return isOutboundGate(gate) ? gate.run(value, params, ctx) : { ok: true }
    },
    (id, before, after) => (droppedText(before, after) ? `gate ${id} tried to drop message text` : null),
  )
}

export function runInboundGates(
  event: InboundEvent,
  gates: GatesInForce,
  ctx: InboundGateContext = {},
): Promise<PipelineResult<InboundEvent>> {
  return settle(
    INBOUND_ORDER,
    gates,
    event,
    (id, value, params) => {
      const gate = gateFor(id)
      return isInboundGate(gate) ? gate.run(value, params, ctx) : { ok: true }
    },
    (id, before, after) => (before.text !== after.text ? `gate ${id} tried to change inbound text` : null),
  )
}

export function runRouterGates(
  event: InboundEvent,
  gates: GatesInForce,
  ctx: RouterGateContext = {},
): Promise<PipelineResult<RouteIntent>> {
  const start: RouteIntent = { event, unit: null, session_key: null, open_work_item: false }
  return settle(
    ROUTER_ORDER,
    gates,
    start,
    (id, value, params) => {
      const gate = gateFor(id)
      return isRouterGate(gate) ? gate.run(value, params, ctx) : { ok: true }
    },
    (id, before, after) => (before.event !== after.event ? `gate ${id} tried to change the event` : null),
  )
}
