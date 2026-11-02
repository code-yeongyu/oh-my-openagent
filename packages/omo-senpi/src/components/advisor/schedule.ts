import type { OmoAdvisorSettings } from "@oh-my-opencode/omo-config-core"

import type { AdvisorSessionWindow } from "./session-window"

type ScheduleSettings = Pick<OmoAdvisorSettings, "check_every" | "cooldown" | "max_per_session">

export function shouldAskGate(window: AdvisorSessionWindow, settings: ScheduleSettings): boolean {
  if (window.inFlight) return false
  if (window.advices >= settings.max_per_session && settings.max_per_session > 0) return false
  if (window.toolResults - window.lastGateAt < settings.check_every) return false
  if (window.lastAdviceAt !== undefined && window.toolResults - window.lastAdviceAt < settings.cooldown) return false
  return true
}
