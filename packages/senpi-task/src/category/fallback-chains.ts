import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/category-model-requirements.ts.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
// senpi-only differences (model-core/omo-opencode carry neither; the OpenCode and Codex editions have
// no such providers):
//   - kimi rungs carry BOTH provider ids ("kimi-coding" senpi registry id and the "kimi-for-coding"
//     models.dev/opencode id); model-core carries "kimi-for-coding" only.
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
    // The Fast (priority) tier exists only on the ChatGPT subscription lane; Copilot and OpenCode Zen
    // serve plain gpt-6-sol, so the next rung keeps the lane open there at the same effort.
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-sol-fast", variant: "medium" },
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: "gpt-6-sol",
      variant: "medium",
    }
  ],
  "deep-high": [
    {
      providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
      model: "gpt-6-astra",
      variant: "xhigh",
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
    { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
    {
      providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
      model: "qwen3.6-flash",
      variant: "low",
    },
    { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
    { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
    { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot"],
      model: "claude-haiku-4-5",
      variant: "off",
    }
  ],
  "unspecified-low": [
    { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "max" },
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
      variant: "max",
    },
    { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
    { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
  ],
  "unspecified-high": [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-opus-5-5",
      variant: "medium",
    },
    { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
    {
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: "kimi-k3",
      variant: "max",
    }
  ],
  writing: [
    {
      providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "low",
    },
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
