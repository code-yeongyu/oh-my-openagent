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
 * chains: senpi-only `kimi-coding` plus the leftover OpenCode `kimi-for-coding`
 * alias those chains keep, and the engine GLM ids `zai` / `zai-coding-cn` (not
 * OpenCode's `zai-coding-plan`; #8824).
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
 * overlay that names `openai/` is scoped to that provider.
 *
 * Unset sessions start on Daily · Normal, or on the first lane in `DEFAULT_MODEL_PROFILE_ORDER`
 * that resolves (#10029). Daily is OmO's recommendation, so every builtin is a lane and there
 * is no separate "Recommended" profile: the retired `recommended` id (`RETIRED_MODEL_PROFILE_IDS`)
 * starts the same default. Every builtin rung is served ONLY by its listed providers: a gateway
 * aggregator's vendor-prefixed copy (`opengateway/anthropic/claude-opus-5-5`) never becomes the
 * session model (#9146).
 */
export type ModelProfileFamily = "daily" | "geeky"
export type ModelProfileTier = "normal" | "heavy"

export type BuiltinModelProfile = {
  readonly displayName: string
  readonly description: string
  /** Picker axes: every builtin is a lane. */
  readonly family: ModelProfileFamily
  readonly tier: ModelProfileTier
  readonly models: readonly DelegateFallbackEntry[]
}

/**
 * Fresh-session default when `model_profile` is unset, in the order tried: the first lane that
 * resolves on the connected providers wins; when none does, the first is reported unavailable.
 * Not written back to config.
 */
export const DEFAULT_MODEL_PROFILE_ORDER = ["daily-normal", "daily-heavy", "geeky-normal", "geeky-heavy"] as const
export const DEFAULT_MODEL_PROFILE_ID = DEFAULT_MODEL_PROFILE_ORDER[0]

/**
 * Builtin ids that no longer exist but that a saved config may still name (#10029). A config
 * naming one starts the unset default with a one-time log line, never the unknown-profile
 * notice, unless the user's own `model_profiles` defines that name.
 */
export const RETIRED_MODEL_PROFILE_IDS: ReadonlySet<string> = new Set(["recommended"])

const CLAUDE_PROVIDERS = ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"] as const
const KIMI_PROVIDERS = ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"] as const
// Engine Z.AI ids. `omo setup` imports OpenCode's `zai-coding-plan` key as `zai` (#8799).
const GLM_PROVIDERS = ["zai", "zai-coding-cn", "opencode-go"] as const
const GPT_PROVIDERS = ["chatgpt-subscription", "openai", "github-copilot", "opencode"] as const
// GPT-6.1 Sol and its Fast tier are served only on the two OpenAI lanes (not Copilot or OpenCode Zen),
// so their rungs list just those; the rung behind them (GPT-5.6 Sol in Geeky · Normal) keeps the
// profile on every GPT provider.
const GPT_6_1_PROVIDERS = ["chatgpt-subscription", "openai"] as const

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
      { providers: [...GPT_6_1_PROVIDERS], model: "gpt-6.1-sol-fast", variant: "medium" },
      { providers: [...GPT_6_1_PROVIDERS], model: "gpt-6.1-sol", variant: "medium" },
      { providers: [...GPT_PROVIDERS], model: "gpt-5.6-sol", variant: "medium" },
    ],
  },
  "geeky-heavy": {
    family: "geeky",
    tier: "heavy",
    displayName: "Geeky · Heavy",
    description: "Works on one task and thinks it over from every side.",
    models: [{ providers: [...GPT_PROVIDERS], model: "gpt-6-astra", variant: "high" }],
  },
})
