import type { OmoAdvisorSettings } from "@oh-my-opencode/omo-config-core"

import type { AdvisorSessionWindow } from "./session-window"

type ScheduleSettings = Pick<OmoAdvisorSettings, "min_calls" | "check_every" | "cooldown" | "max_per_session">

export function shouldAskGate(window: AdvisorSessionWindow, settings: ScheduleSettings): boolean {
  if (window.inFlight) return false
  if (settings.max_per_session > 0 && window.advices >= settings.max_per_session) return false
  if (window.toolResults < settings.min_calls) return false
  if (window.toolResults % settings.check_every !== 0) return false
  if (window.lastAdviceAt !== undefined && window.toolResults - window.lastAdviceAt < settings.cooldown) return false
  return true
}
