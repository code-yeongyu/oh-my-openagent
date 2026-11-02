import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { AdvisorJudgement } from "./prompt"
import type { AdvisorSessionWindow } from "./session-window"

export const ADVISOR_ADVICE_TYPE = "omo-advisor:advice"
export const ADVISOR_DELIVERY_ENTRY_TYPE = "omo-advisor:delivery"

export interface HeldPlan {
  readonly content: string
  readonly model: string
  readonly judgement: AdvisorJudgement
  readonly firedAt: number
}

export interface PlanHolder {
  readonly window: AdvisorSessionWindow
  heldPlan: HeldPlan | undefined
}

// A plan is finished seconds to minutes after the gate fired, so it is never sent from there. It
// is held and steered at the next tool result: only then is the turn executing tools, so the steer
// rides it. A steer sent while the final answer streams starts one more turn, and one sent to an
// idle session lands in front of the user's next, unrelated prompt; a run that settles or a new
// prompt therefore drops the held plan instead.
export async function deliverHeldPlan(
  pi: Pick<SenpiExtensionAPI, "sendMessage" | "appendEntry">,
  holder: PlanHolder,
  eventCtx: unknown,
  logger: ComponentLogger,
): Promise<void> {
  const plan = holder.heldPlan
  if (plan === undefined || !atToolBoundary(eventCtx)) return
  holder.heldPlan = undefined
  holder.window.lastAdviceAt = holder.window.toolResults
  await pi.sendMessage(
    { customType: ADVISOR_ADVICE_TYPE, content: plan.content, display: false, details: { model: plan.model, ...plan.judgement } },
    { deliverAs: "steer" },
  )
  pi.appendEntry?.(ADVISOR_DELIVERY_ENTRY_TYPE, { version: 1, delivered: true, firedAt: plan.firedAt, atToolResult: holder.window.toolResults })
  logger.info("omo-senpi advisor advice delivered", { model: plan.model, ...plan.judgement })
}

export function dropHeldPlan(pi: Pick<SenpiExtensionAPI, "appendEntry">, holder: PlanHolder, reason: "settled" | "new_prompt"): void {
  const plan = holder.heldPlan
  if (plan === undefined) return
  holder.heldPlan = undefined
  pi.appendEntry?.(ADVISOR_DELIVERY_ENTRY_TYPE, { version: 1, delivered: false, reason, firedAt: plan.firedAt })
}

function atToolBoundary(eventCtx: unknown): boolean {
  if (typeof eventCtx !== "object" || eventCtx === null) return true
  const context = eventCtx as Record<string, unknown>
  if (typeof context["isIdle"] === "function" && Reflect.apply(context["isIdle"], context, []) === true) return false
  if (typeof context["hasPendingMessages"] === "function" && Reflect.apply(context["hasPendingMessages"], context, []) === true) return false
  return true
}
