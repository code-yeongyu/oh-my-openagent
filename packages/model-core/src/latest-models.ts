/**
 * The current member of each model family (#10141). Every default, rung, alias, gate and migration
 * target meaning "the newest model of this family" reads it from here, so a bump is one edit;
 * `script/latest-model-ids-audit.test.ts` rejects a literal copy elsewhere. Deliberate older rungs
 * (`claude-opus-4-6`, `gpt-5.6-sol`) stay literal. No imports: consumers outside the barrel use the
 * `@oh-my-opencode/model-core/latest-models` subpath. Not covered: the Codex plugin's data files
 * (`omo-codex/plugin` agent TOMLs, `migrate-codex-config/catalog.mjs`, `model-catalog.json`) still
 * spell `gptAstra`'s id, so a Codex default bump also edits those.
 */
export const LATEST_MODEL_BY_FAMILY = {
  claudeOpus: "claude-opus-5-5",
  claudeSonnet: "claude-sonnet-5-5",
  claudeHaiku: "claude-haiku-5-5",
  claudeFable: "claude-fable-5-1",
  gptAstra: "gpt-6-astra",
  gptSol: "gpt-6.1-sol",
  gptSolFast: "gpt-6.1-sol-fast",
  gptLunaFast: "gpt-6-luna-fast",
  glm: "glm-5.3",
  glmFlash: "glm-5.3-flash",
  kimi: "kimi-k3",
  geminiPro: "gemini-4-argon",
} as const

export type ModelFamily = keyof typeof LATEST_MODEL_BY_FAMILY
