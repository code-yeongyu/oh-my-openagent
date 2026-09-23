import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

/**
 * A model profile is a named, ordered model chain a human picks by INTENT ("Capable", "Deep work")
 * instead of by model id. It is not the `profiles` key in omo.json: that one is a VSCode-style
 * config-layer overlay activated by `OMO_PROFILE`.
 *
 * Every rung is a `DelegateFallbackEntry` - `{ providers, model, variant? }`, the exact shape
 * `packages/senpi-task/src/category/fallback-chains.ts` uses - and NOT a single `provider/model`
 * string, so a Copilot-only, Bedrock-only or gateway-only user still resolves the model instead of
 * reading "unavailable" while the model sits right there in the registry. Provider spellings are
 * copied from those chains, including the senpi-only `kimi-coding` id.
 *
 * The table is additive data: an `omo.json` `model_profiles.<name>` entry replaces the builtin of
 * the same name WHOLESALE (see `resolve.ts`), so a later change here can never silently override a
 * chain a user wrote.
 */
export type BuiltinModelProfile = {
  readonly displayName: string
  readonly description: string
  readonly models: readonly DelegateFallbackEntry[]
}

// Key order is the order a picker renders. `deep` is deliberately NOT an id: builtin delegation
// categories already carry that name, and the two axes never compete (a profile picks the MAIN
// session model; categories keep their own chains).
//
// Every Claude rung is headed by `anthropic-subscription`, senpi's Claude subscription lane, exactly
// like the category chains (#8051): rung provider order IS the ranking, so a machine logged in there
// that also holds an OpenCode Zen key must not land on the metered `opencode` lane.
export const BUILTIN_MODEL_PROFILES: Readonly<Record<string, BuiltinModelProfile>> = Object.freeze({
  capable: {
    displayName: "Capable",
    description: "The strongest generalist available - the default pick when you do not want to think about models.",
    models: [
      {
        providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "xhigh",
      },
      {
        providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
        model: "kimi-k3",
        variant: "max",
      },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
    ],
  },
  // A MAIN session model for hard problems: Astra first, GPT-6 Sol as the one step down. It is its
  // own chain, not the deep-high + deep-low category chains glued together, so it stops at GPT-6 Sol
  // instead of inheriting the deep-low GPT-5.6 Sol tail.
  "deep-work": {
    displayName: "Deep work",
    description: "Maximum reasoning for hard problems - GPT-6 Astra, then GPT-6 Sol.",
    models: [
      {
        providers: ["chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-astra",
        variant: "high",
      },
      {
        providers: ["chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-sol",
        variant: "medium",
      },
    ],
  },
})
