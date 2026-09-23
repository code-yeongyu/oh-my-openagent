import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/agent-model-requirements.ts.
// Key rename: the two curated agents carry their canonical ids here (plan-consultant, plan-reviewer);
// the mirrored rungs (models, providers, variants, order) are unchanged from the mirror source.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
// senpi-only difference: every claude-* rung is headed by "anthropic-subscription", senpi's Claude subscription
// lane, so a Claude Pro/Max login outranks the metered `opencode` lane (#8051; see the category chains
// for the full rationale). model-core stays without it - no other edition has that provider.
// senpi-only difference: every GPT rung lists "chatgpt-subscription" first and "openai" directly after it,
// so the subscription outranks the API-key lane (#8300) and an `openai`-only machine still reaches the
// rung (#8734; see the category chains). model-core lists "openai" first, OpenCode's single OpenAI id.
// The ulw reviewer agents are absent by design: they resolve their model through the `categories`
// field on their definition (see resolve-agent-categories.ts), not through a hand-mirrored chain.
// Parity with the mirror source is enforced by omo-senpi's builtin-agent-chain-parity test (#8259).
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  explore: [
    { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" }
  ],
  librarian: [
    { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" }
  ],
  "plan-consultant": [
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5-5",
      variant: "max",
    },
    {
      providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
      model: "kimi-k3",
      variant: "max",
    }
  ],
  "plan-reviewer": [
    { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-astra", variant: "xhigh" },
    { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-6-astra", variant: "high" },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5-5",
      variant: "max",
    },
    {
      providers: ["google", "github-copilot", "opencode"],
      model: "gemini-3.1-pro",
      variant: "high",
    },
    { providers: ["opencode-go"], model: "glm-5.2" }
  ],
}
