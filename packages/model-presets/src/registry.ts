import type { ModelPreset } from "./types"

export const PROMPT_KEYS = {
  ORACLE_DS_V4_PRO: "ORACLE_DS_V4_PRO",
  ORACLE_DS_V4_FLASH: "ORACLE_DS_V4_FLASH",
  ORACLE_MIMO_V25: "ORACLE_MIMO_V25",
  EXPLORE_DS_V4_PRO: "EXPLORE_DS_V4_PRO",
  EXPLORE_DS_V4_FLASH: "EXPLORE_DS_V4_FLASH",
  EXPLORE_MIMO_V25: "EXPLORE_MIMO_V25",
  LIBRARIAN_DS_V4_PRO: "LIBRARIAN_DS_V4_PRO",
  LIBRARIAN_DS_V4_FLASH: "LIBRARIAN_DS_V4_FLASH",
  LIBRARIAN_MIMO_V25: "LIBRARIAN_MIMO_V25",
} as const

export type PromptKey = typeof PROMPT_KEYS[keyof typeof PROMPT_KEYS]

export function getBuiltinPresets(): ModelPreset[] {
  return [
    // Oracle
    { agent: "oracle", model: "deepseek-v4-pro", promptKey: PROMPT_KEYS.ORACLE_DS_V4_PRO,
      config: { thinking: { type: "enabled" as const, budgetTokens: 32000 } }, priority: 20 },
    { agent: "oracle", model: ["deepseek-v4-flash", "deepseek-v4"], promptKey: PROMPT_KEYS.ORACLE_DS_V4_FLASH, config: {} },
    { agent: "oracle", model: "mimo-v2.5-pro", promptKey: PROMPT_KEYS.ORACLE_MIMO_V25, config: {} },
    // Explore
    { agent: "explore", model: "deepseek-v4-pro", promptKey: PROMPT_KEYS.EXPLORE_DS_V4_PRO,
      config: { thinking: { type: "enabled" as const, budgetTokens: 32000 } }, priority: 20 },
    { agent: "explore", model: ["deepseek-v4-flash", "deepseek-v4"], promptKey: PROMPT_KEYS.EXPLORE_DS_V4_FLASH, config: {} },
    { agent: "explore", model: "mimo-v2.5-pro", promptKey: PROMPT_KEYS.EXPLORE_MIMO_V25, config: {} },
    // Librarian
    { agent: "librarian", model: "deepseek-v4-pro", promptKey: PROMPT_KEYS.LIBRARIAN_DS_V4_PRO,
      config: { thinking: { type: "enabled" as const, budgetTokens: 32000 } }, priority: 20 },
    { agent: "librarian", model: ["deepseek-v4-flash", "deepseek-v4"], promptKey: PROMPT_KEYS.LIBRARIAN_DS_V4_FLASH, config: {} },
    { agent: "librarian", model: "mimo-v2.5-pro", promptKey: PROMPT_KEYS.LIBRARIAN_MIMO_V25, config: {} },
  ]
}
