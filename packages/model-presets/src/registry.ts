import type { ModelPreset } from "./types"

export const PROMPT_KEYS = {
  ORACLE_DS_V4_PRO: "ORACLE_DS_V4_PRO",
  ORACLE_DS_V4_FLASH: "ORACLE_DS_V4_FLASH",
  ORACLE_MIMO_V25: "ORACLE_MIMO_V25",
} as const

export type PromptKey = typeof PROMPT_KEYS[keyof typeof PROMPT_KEYS]

export function getBuiltinPresets(): ModelPreset[] {
  return [
    { agent: "oracle", model: "deepseek-v4-pro", promptKey: PROMPT_KEYS.ORACLE_DS_V4_PRO,
      config: { thinking: { type: "enabled" as const, budgetTokens: 32000 } }, priority: 20 },
    { agent: "oracle", model: ["deepseek-v4-flash", "deepseek-v4"], promptKey: PROMPT_KEYS.ORACLE_DS_V4_FLASH, config: {} },
    { agent: "oracle", model: "mimo-v2.5-pro", promptKey: PROMPT_KEYS.ORACLE_MIMO_V25, config: {} },
  ]
}
