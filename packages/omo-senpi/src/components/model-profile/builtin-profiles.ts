import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

/**
 * A model profile is a named, ordered model chain a human picks by lane
 * ("Daily · Normal", "Geeky · Heavy") instead of by model id. It is not the
 * `profiles` key in omo.json: that one is a VSCode-style config-layer overlay
 * activated by `OMO_PROFILE`.
 *
 * Every rung is a `DelegateFallbackEntry` - `{ providers, model, variant? }`, the
 * exact shape `packages/senpi-task/src/category/fallback-chains.ts` uses - and NOT
 * a single `provider/model` string, so a Copilot-only, Bedrock-only or gateway-only
 * user still resolves the model instead of reading "unavailable" while the model
 * sits right there in the registry. Provider spellings are copied from those
 * chains, including the senpi-only `kimi-coding` id.
 *
 * The table is additive data: an `omo.json` `model_profiles.<name>` entry replaces
 * the builtin of the same name WHOLESALE (see `resolve.ts`), so a later change
 * here can never silently override a chain a user wrote.
 *
 * There is no alias, migration, or compatibility shim for retired ids (`capable`,
 * `deep-work`, `simple-work`). A stale `model_profile` value is `unknown`.
 *
 * Builtin GPT rungs rank providers exactly like the `deep-low` / `deep-high`
 * category chains (#8737): the ChatGPT subscription first, then the `openai`
 * API/proxy lane, then Copilot and OpenCode where they serve the model. A user
 * overlay that names `openai/` is scoped to that provider. Unset sessions
 * default to Daily · Normal.
 */
export type ModelProfileFamily = "daily" | "geeky"
export type ModelProfileTier = "normal" | "heavy"

export type BuiltinModelProfile = {
  readonly displayName: string
  readonly description: string
  readonly family: ModelProfileFamily
  readonly tier: ModelProfileTier
  readonly models: readonly DelegateFallbackEntry[]
}

/** Fresh-session default when `model_profile` is unset. Not written back to config. */
export const DEFAULT_MODEL_PROFILE_ID = "daily-normal"

const CLAUDE_PROVIDERS = ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"] as const
const KIMI_PROVIDERS = ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"] as const
const GLM_PROVIDERS = ["zai-coding-plan", "opencode-go"] as const
const GPT_PROVIDERS = ["chatgpt-subscription", "openai", "github-copilot", "opencode"] as const

// Key order is the order a picker renders. `deep` is deliberately NOT an id: builtin
// delegation categories already carry that name, and the two axes never compete (a
// profile picks the MAIN session model; categories keep their own chains).
//
// Every Claude rung is headed by `anthropic-subscription`, senpi's Claude subscription
// lane, exactly like the category chains (#8051): rung provider order IS the ranking.
export const BUILTIN_MODEL_PROFILES: Readonly<Record<string, BuiltinModelProfile>> = Object.freeze({
  "daily-normal": {
    family: "daily",
    tier: "normal",
    displayName: "Daily · Normal",
    description: "Gets any task done without fuss.",
    models: [
      { providers: [...CLAUDE_PROVIDERS], model: "claude-opus-5-5", variant: "medium" },
      { providers: [...KIMI_PROVIDERS], model: "kimi-k3", variant: "max" },
      { providers: [...GLM_PROVIDERS], model: "glm-5.3", variant: "max" },
    ],
  },
  "daily-heavy": {
    family: "daily",
    tier: "heavy",
    displayName: "Daily · Heavy",
    description: "Gets any task done, after thinking it over from more sides.",
    models: [{ providers: [...CLAUDE_PROVIDERS], model: "claude-fable-5-1", variant: "xhigh" }],
  },
  "geeky-normal": {
    family: "geeky",
    tier: "normal",
    displayName: "Geeky · Normal",
    description: "Works on one task and thinks it through.",
    models: [
      // The Fast tier exists only on the ChatGPT subscription and API lanes; Copilot and
      // OpenCode serve plain gpt-6-sol, so the next rung keeps the lane open at the same effort.
      { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-sol-fast", variant: "medium" },
      { providers: [...GPT_PROVIDERS], model: "gpt-6-sol", variant: "medium" },
    ],
  },
  "geeky-heavy": {
    family: "geeky",
    tier: "heavy",
    displayName: "Geeky · Heavy",
    description: "Works on one task and thinks it over from every side.",
    models: [{ providers: [...GPT_PROVIDERS], model: "gpt-6-astra", variant: "xhigh" }],
  },
})
