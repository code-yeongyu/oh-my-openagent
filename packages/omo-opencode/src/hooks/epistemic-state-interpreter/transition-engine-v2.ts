import type { TransitionThresholds } from "../../config/schema/epistemic-v6"
import type { HookBalance } from "./hook-entity-types"
import type { AmmissibilitaState } from "./multi-plane-types"

export interface TransitionResult {
  from: AmmissibilitaState
  to: AmmissibilitaState
  transitioned: boolean
  reason: string
}

export function computeTransitionV2(
  currentState: AmmissibilitaState,
  balance: HookBalance,
  thresholds: TransitionThresholds,
  pianoBPlausibile?: boolean,
): TransitionResult {
  const noChange = (reason: string): TransitionResult =>
    ({ from: currentState, to: currentState, transitioned: false, reason })

  if (pianoBPlausibile === true && balance.direction === "retention") {
    if (currentState === "da_verificare" || currentState === "non_escluso") {
      return {
        from: currentState,
        to: "plausibile",
        transitioned: true,
        reason: `pianoB threshold crossed: ${currentState} -> plausibile`,
      }
    }

    if (currentState === "possibile") {
      return {
        from: currentState,
        to: "da_verificare",
        transitioned: true,
        reason: "pianoB threshold crossed: possibile -> da_verificare",
      }
    }
  }

  if (
    balance.direction === "expulsion"
    && balance.negativeStrengthSum >= thresholds.expulsion_min_strength
  ) {
    if (currentState === "escluso") {
      return noChange("already escluso")
    }

    if (currentState === "escluso_operativamente") {
      return {
        from: currentState,
        to: "escluso",
        transitioned: true,
        reason: "strong HN: escluso_operativamente -> escluso",
      }
    }

    return {
      from: currentState,
      to: "escluso_operativamente",
      transitioned: true,
      reason: `strong HN (${balance.negativeStrengthSum}): ${currentState} -> escluso_operativamente`,
    }
  }

  if (
    balance.direction === "expulsion"
    && balance.negativeStrengthSum >= thresholds.retrocession_min_strength
  ) {
    switch (currentState) {
      case "plausibile":
        return { from: currentState, to: "da_verificare", transitioned: true, reason: "moderate HN: plausibile -> da_verificare" }
      case "da_verificare":
        return { from: currentState, to: "non_escluso", transitioned: true, reason: "moderate HN: da_verificare -> non_escluso" }
      case "non_escluso":
        return { from: currentState, to: "escluso_operativamente", transitioned: true, reason: "moderate HN: non_escluso -> escluso_operativamente" }
      default:
        return noChange(`no retrocession from ${currentState}`)
    }
  }

  if (
    balance.direction === "retention"
    && balance.positiveStrengthSum >= thresholds.reopening_min_strength
  ) {
    if (currentState === "escluso_operativamente") {
      return {
        from: currentState,
        to: "non_escluso",
        transitioned: true,
        reason: "HP reopening: escluso_operativamente -> non_escluso",
      }
    }

    if (currentState === "escluso") {
      return {
        from: currentState,
        to: "possibile",
        transitioned: true,
        reason: "HP strong reopening: escluso -> possibile",
      }
    }
  }

  if (
    balance.direction === "retention"
    && balance.positiveStrengthSum >= thresholds.advancement_min_strength
  ) {
    const strength = balance.positiveStrengthSum
    const min = thresholds.advancement_min_strength

    switch (currentState) {
      case "possibile": {
        if (strength >= min * 3) {
          return { from: currentState, to: "plausibile", transitioned: true, reason: "strong HP jump: possibile -> plausibile" }
        }

        if (strength >= min * 2) {
          return { from: currentState, to: "da_verificare", transitioned: true, reason: "HP jump: possibile -> da_verificare" }
        }

        return { from: currentState, to: "non_escluso", transitioned: true, reason: "HP: possibile -> non_escluso" }
      }
      case "non_escluso": {
        if (strength >= min * 2) {
          return { from: currentState, to: "plausibile", transitioned: true, reason: "strong HP jump: non_escluso -> plausibile" }
        }

        return { from: currentState, to: "da_verificare", transitioned: true, reason: "HP: non_escluso -> da_verificare" }
      }
      case "da_verificare":
        return { from: currentState, to: "plausibile", transitioned: true, reason: "HP: da_verificare -> plausibile" }
      default:
        return noChange(`no advancement from ${currentState}`)
    }
  }

  return noChange("insufficient hook force for transition")
}
