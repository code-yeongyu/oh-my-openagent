import type { OmoKeywordDetectorSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"

export type LoadKeywordDetectorSettings = (cwd: string) => OmoKeywordDetectorSettings | undefined

const ULTRAWORK_DISABLED_FLAG = "omo-senpi-ultrawork-disabled"

export function isUltraworkFlagDisabled(ctx: ComponentContext): boolean {
  return ctx.config.getFlag(ULTRAWORK_DISABLED_FLAG) === true
}

export function loadKeywordDetectorSettings(cwd: string): OmoKeywordDetectorSettings | undefined {
  return loadSenpiOmoConfig({ cwd }).config.keyword_detector
}

/**
 * The same omo.jsonc `keyword_detector` keys OpenCode reads (#14389): `disabled_keywords` is a
 * denylist and `enabled_expansions` an allowlist, so either can turn the ultrawork keyword off for
 * a project or a user without the per-launch flag.
 */
export function isUltraworkKeywordDisabled(settings: OmoKeywordDetectorSettings | undefined): boolean {
  if (settings?.disabled_keywords?.includes("ultrawork") === true) return true
  return settings?.enabled_expansions !== undefined && !settings.enabled_expansions.includes("ultrawork")
}
