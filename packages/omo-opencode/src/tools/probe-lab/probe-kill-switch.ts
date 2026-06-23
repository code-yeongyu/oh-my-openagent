import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const GLOBAL_KILL_SWITCH_KEY = "global_kill_switch"

export function isGlobalKillSwitchActive(ctx: ProbeLabContext): boolean {
  const killSwitch = ctx.store.getProbeLabConfig(GLOBAL_KILL_SWITCH_KEY)
  return killSwitch?.value === "true" || killSwitch?.value === "1"
}
