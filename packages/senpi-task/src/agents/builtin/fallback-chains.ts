import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/agent-model-requirements.ts.
// Key rename: the two curated agents carry their canonical ids here (plan-consultant, plan-reviewer);
// the mirrored rungs (models, providers, variants, order) are unchanged from the mirror source.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
// senpi-only difference: every claude-* rung is headed by "anthropic-subscription", senpi's Claude subscription
// lane, so a Claude Pro/Max login outranks the metered `opencode` lane (#8051; see the category chains
// for the full rationale). model-core stays without it - no other edition has that provider.
// senpi-only difference: no rung lists "openai", the metered API-key lane; "chatgpt-subscription" is the only
// OpenAI lane (#8300; see the category chains). model-core keeps "openai" for OpenCode.
// The ulw reviewer agents are absent by design: they resolve their model through the `categories`
// field on their definition (see resolve-agent-categories.ts), not through a hand-mirrored chain.
// Parity with the mirror source is enforced by omo-senpi's builtin-agent-chain-parity test (#8259).
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  explore: [
    { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
    { providers: ["chatgpt-subscription"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["chatgpt-subscription"], model: "gpt-5.4-nano" }
  ],
  librarian: [
    { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
    { providers: ["chatgpt-subscription"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["chatgpt-subscription"], model: "gpt-5.4-nano" }
  ],
  "plan-consultant": [
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-fable-5-1",
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic"],
      model: "claude-opus-5-5",
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5",
      variant: "max",
    },
    {
      providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
      model: "kimi-k3",
      variant: "max",
    }
  ],
  "plan-reviewer": [
    { providers: ["chatgpt-subscription"], model: "gpt-6-astra", variant: "xhigh" },
    { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
    { providers: ["chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "high" },
    {
      providers: ["anthropic-subscription", "anthropic"],
      model: "claude-opus-5-5",
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5",
      variant: "max",
    },
    {
      providers: ["google", "github-copilot", "opencode"],
      model: "gemini-3.1-pro",
      variant: "high",
    },
    { providers: ["opencode-go"], model: "glm-5.3" }
  ],
}
