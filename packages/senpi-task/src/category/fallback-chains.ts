import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/category-model-requirements.ts.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
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
  "visual-engineering": [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "max",
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
    }
  ],
  architect: [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "max",
    }
  ],
  ultrabrain: [
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-astra", variant: "max" },
    { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-6-astra", variant: "max" },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-5.6-sol", variant: "max" },
    { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-5.6-sol", variant: "max" }
  ],
  "deep-low": [
    // GPT-6.1 Sol leads at the same medium effort: it matches GPT-6 Sol's price with near-Astra
    // quality, but only the ChatGPT subscription and OpenAI lanes serve it (plain, then the Fast
    // tier). GPT-5.6 Sol stays behind it so Copilot, OpenCode Zen and a registry without 6.1 still
    // resolve the lane.
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6.1-sol", variant: "medium" },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6.1-sol-fast", variant: "medium" },
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
      model: "gpt-6-astra",
      variant: "high",
    }
  ],
  artistry: [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "max",
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
    }
  ],
  quick: [
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot"],
      model: "claude-haiku-5-5",
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
    { providers: ["zai", "zai-coding-cn"], model: "glm-5.3-flash", variant: "low" },
    { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" }
  ],
  "unspecified-low": [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-sonnet-5-5",
      variant: "medium",
    },
    { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "high" },
    { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: "gpt-5.6-terra",
      variant: "high",
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
      model: "claude-opus-5-5",
      variant: "medium",
    },
    { providers: ["zai", "zai-coding-cn", "opencode-go"], model: "glm-5.3", variant: "max" },
    {
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: "kimi-k3",
      variant: "max",
    }
  ],
  writing: [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-opus-5-5",
      variant: "low",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-opus-4-6",
      variant: "max",
    }
  ],
}
