import { FABLE_55_LAUNCH, launchRungs } from "@oh-my-opencode/model-core"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

// Source of truth mirrored from packages/model-core/src/category-model-requirements.ts.
// Model IDs share the launch block; chain rows remain independently mirrored for parity checks.
// senpi-only differences (model-core/omo-opencode carry neither; the OpenCode and Codex editions have
// no such providers):
//   - kimi rungs carry BOTH provider ids ("kimi-coding" senpi registry id and the "kimi-for-coding"
//     models.dev/opencode id); model-core carries "kimi-for-coding" only.
//   - every rung names a thinking level senpi's model catalog accepts for that model (#9378). The
//     quick lane's opencode-go minimax-m3 and minimax-m2.7 take no `max`, so they carry no variant and
//     run at the model's default; unspecified-low's mimo-v2.6-pro, qwen3.8-max-preview and mimo-v2.5-pro
//     stop at `high`. model-core keeps `max` on all five: OpenCode derives its own variants.
//   - glm rungs use engine ids "zai" and "zai-coding-cn". model-core carries OpenCode's
//     "zai-coding-plan"; `omo setup` imports that key as "zai" (#8799, #8824).
//   - every claude-* rung is headed by "anthropic-subscription", senpi's Claude subscription lane
//     (Claude Pro/Max). It serves the same model ids as "anthropic", so a machine that is logged in
//     there AND holds an OpenCode Zen key must not be routed to the metered `opencode/claude-*` lane
//     (#8051). Rung provider order IS the ranking in resolveModelForDelegateTask, so it goes first,
//     mirroring senpi's own PROVIDER_PRECEDENCE in retry-fallback/expansion.ts.
//   - every GPT rung lists "chatgpt-subscription" (ChatGPT subscription) first and "openai" (the
//     API-key lane, or an OpenAI-compatible proxy configured under that id) directly after it.
//     Rung provider order IS the ranking, so a machine holding both never routes delegated GPT work
//     to API billing (#8300), while an `openai`-only machine still gets every GPT rung, both at
//     selection and in the runtime fallback list, which walks listed providers only (#8734).
//     model-core lists "openai" first: it is OpenCode's single OpenAI provider id and already
//     covers the ChatGPT login there.
export const CATEGORY_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  "visual-engineering": launchRungs([
    // Argon at its lowest accepted thinking level leads (#10187, owner decision 2026-10-15):
    // the catalog maps off/minimal to null for this model, so `low` is the floor. Copilot waits for
    // code-yeongyu/senpi#3379 (its row exposes no thinking control). A pinned engine whose catalog
    // has no Argon row leaves this rung unresolvable, so the chain behaves as before until adoption.
    { providers: ["google", "google-vertex", "opencode"], model: LATEST_MODEL_BY_FAMILY.geminiPro, variant: "low" },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: FABLE_55_LAUNCH.id,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeFable,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "max",
    },
    {
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: LATEST_MODEL_BY_FAMILY.kimi,
      variant: "max",
    }
  ]),
  architect: launchRungs([
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: FABLE_55_LAUNCH.id,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeFable,
      variant: "max",
    }
  ]),
  ultrabrain: [
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
    { providers: ["github-copilot"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-5.6-sol", variant: "max" },
    { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-5.6-sol", variant: "max" }
  ],
  "deep-low": [
    // GPT-6.1 Sol leads at the same medium effort: it matches GPT-6 Sol's price with near-Astra
    // quality, but only the ChatGPT subscription and OpenAI lanes serve it (plain, then the Fast
    // tier). GPT-5.6 Sol stays behind it so Copilot, OpenCode Zen and a registry without 6.1 still
    // resolve the lane.
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptSol, variant: "medium" },
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptSolFast, variant: "medium" },
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: "gpt-5.6-sol",
      variant: "medium",
    },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-5.6-sol-fast", variant: "medium" }
  ],
  "deep-high": [
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.gptAstra,
      variant: "high",
    }
  ],
  artistry: launchRungs([
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: FABLE_55_LAUNCH.id,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeFable,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "max",
    },
    {
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: LATEST_MODEL_BY_FAMILY.kimi,
      variant: "max",
    }
  ]),
  quick: [
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot"],
      model: LATEST_MODEL_BY_FAMILY.claudeHaiku,
      variant: "medium",
    },
    { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
    {
      providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
      model: "qwen3.6-flash",
      variant: "low",
    },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
    // Trailing, so every provider set that resolved quick before resolves the same model: these
    // rungs only answer a machine logged in to Z.ai or Xiaomi alone. Neither flash model can turn
    // thinking off (glm-5.3-flash maps `off` to null, mimo-v2.6-flash refuses disabled thinking), so
    // both run at the lowest effort they accept, like qwen3.6-flash.
    { providers: ["zai", "zai-coding-cn"], model: LATEST_MODEL_BY_FAMILY.glmFlash, variant: "low" },
    { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" }
  ],
  "unspecified-low": [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeSonnet,
      variant: "medium",
    },
    { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "high" },
    { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
    // GLM 5.3 sits ahead of the GPT rungs so a Claude + Z.ai user does not fall from Sonnet to GPT (#10306).
    { providers: ["zai", "zai-coding-cn", "opencode-go"], model: LATEST_MODEL_BY_FAMILY.glm, variant: "high" },
    // GPT-6.1 Sol is the current GPT default, served only by the OpenAI lanes; GPT-5.6 Sol stays
    // behind it so Copilot, OpenCode Zen and a registry without 6.1 still resolve the lane (#9844).
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptSol, variant: "medium" },
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: "gpt-5.6-sol",
      variant: "medium",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-sonnet-5",
      variant: "low",
    },
    {
      providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
      model: "qwen3.8-max-preview",
      variant: "high",
    },
    { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
    { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "high" }
  ],
  "unspecified-high": [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "medium",
    },
    { providers: ["zai", "zai-coding-cn", "opencode-go"], model: LATEST_MODEL_BY_FAMILY.glm, variant: "max" },
    {
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: LATEST_MODEL_BY_FAMILY.kimi,
      variant: "max",
    }
  ],
  writing: [
    // Argon at its lowest accepted thinking level leads (#10187, owner decision 2026-10-15):
    // the catalog maps off/minimal to null for this model, so `low` is the floor. Copilot waits for
    // code-yeongyu/senpi#3379 (its row exposes no thinking control). A pinned engine whose catalog
    // has no Argon row leaves this rung unresolvable, so the chain behaves as before until adoption.
    { providers: ["google", "google-vertex", "opencode"], model: LATEST_MODEL_BY_FAMILY.geminiPro, variant: "low" },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "low",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-opus-4-6",
      variant: "max",
    }
  ],
}
