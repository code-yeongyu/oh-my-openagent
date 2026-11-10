import { describe, expect, test } from "bun:test"

import { decideDelivery, type TargetState } from "./decision"
import type { GatewayDeliveryMode } from "./types"

const STATES: readonly TargetState[] = ["idle", "mid_turn", "waiting_question", "compacting", "offline"]
const MODES: readonly GatewayDeliveryMode[] = ["auto", "steer", "follow_up"]

const EXPECTED: Readonly<Record<TargetState, Readonly<Record<GatewayDeliveryMode, string>>>> = {
  idle: { auto: "admit:followUp:started", steer: "refuse:not_steerable", follow_up: "admit:followUp:started" },
  mid_turn: { auto: "admit:steer:steered", steer: "admit:steer:steered", follow_up: "admit:followUp:queued" },
  waiting_question: { auto: "admit:followUp:queued", steer: "refuse:not_steerable", follow_up: "admit:followUp:queued" },
  compacting: { auto: "admit:followUp:queued", steer: "refuse:not_steerable", follow_up: "admit:followUp:queued" },
  offline: { auto: "queued_offline", steer: "refuse:turn_conflict", follow_up: "queued_offline" },
}

function label(state: TargetState, mode: GatewayDeliveryMode): string {
  const decision = decideDelivery(state, mode, 3, 3)
  if (decision.kind === "admit") return `admit:${decision.deliverAs}:${decision.expect}`
  if (decision.kind === "refuse") return `refuse:${decision.reason}`
  return decision.kind
}

describe("gateway decision table", () => {
  test("#given every target state and mode #when decided with a current turn epoch #then all fifteen cells match the plan's table", () => {
    const cells = STATES.flatMap((state) => MODES.map((mode) => [state, mode, label(state, mode)] as const))
    expect(cells).toHaveLength(15)
    for (const [state, mode, decided] of cells) expect({ state, mode, decided }).toEqual({ state, mode, decided: EXPECTED[state][mode] })
  })

  test("#given a mid-turn target #when a steer names a stale or missing epoch #then it is a turn conflict, never admitted", () => {
    expect(decideDelivery("mid_turn", "steer", 2, 3)).toEqual({ kind: "refuse", reason: "turn_conflict" })
    expect(decideDelivery("mid_turn", "steer", null, 3)).toEqual({ kind: "refuse", reason: "turn_conflict" })
  })

  test("#given a mid-turn target #when the default mode is decided #then it steers the running turn by its own epoch, whatever the sender named", () => {
    expect(decideDelivery("mid_turn", "auto", null, 7)).toEqual({ kind: "admit", deliverAs: "steer", expected_turn_id: 7, expect: "steered" })
    expect(decideDelivery("mid_turn", "auto", 2, 7)).toEqual({ kind: "admit", deliverAs: "steer", expected_turn_id: 7, expect: "steered" })
  })

  test("#given a mid-turn target whose engine reports no turn epoch #when the default mode is decided #then it queues behind the turn instead of steering blind", () => {
    expect(decideDelivery("mid_turn", "auto", null, null)).toEqual({ kind: "admit", deliverAs: "followUp", expect: "queued" })
  })
})
