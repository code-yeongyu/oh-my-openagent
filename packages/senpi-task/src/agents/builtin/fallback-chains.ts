import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/agent-model-requirements.ts.
// Key rename: the two curated agents carry their canonical ids here (plan-consultant, plan-reviewer);
// the mirrored rungs (models, providers, variants, order) are unchanged from the mirror source.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
// senpi-only difference: every claude-* rung is headed by "claude-sdk-oauth", senpi's Claude subscription
// lane, so a Claude Pro/Max login outranks the metered `opencode` lane (#8051; see the category chains
// for the full rationale). model-core stays without it - no other edition has that provider.
// The ulw reviewer agents are absent by design: they resolve their model through the `categories`
// field on their definition (see resolve-agent-categories.ts), not through a hand-mirrored chain.
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  explore: [
    { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["claude-sdk-oauth", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
  ],
  librarian: [
    { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["claude-sdk-oauth", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
  ],
  "plan-consultant": [
    { providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
    {
      providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5",
      variant: "max",
    },
    {
      providers: ["openai", "openai-codex", "github-copilot", "opencode"],
      model: "gpt-5.6-sol",
      variant: "medium",
    },
    { providers: ["opencode-go"], model: "glm-5.2" },
    { providers: ["kimi-for-coding"], model: "kimi-k3" }
  ],
  "plan-reviewer": [
    { providers: ["openai", "openai-codex"], model: "gpt-6-astra", variant: "xhigh" },
    { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
    { providers: ["openai", "openai-codex", "opencode"], model: "gpt-6-astra", variant: "high" },
    {
      providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"],
      model: "claude-opus-5",
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
