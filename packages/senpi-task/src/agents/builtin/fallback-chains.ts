import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

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
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: LATEST_MODEL_BY_FAMILY.claudeHaiku, variant: "medium" },
    { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m2.7" }
  ],
  librarian: [
    { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
    { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: LATEST_MODEL_BY_FAMILY.claudeHaiku, variant: "medium" },
    { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
    { providers: ["opencode-go"], model: "minimax-m2.7" }
  ],
  "plan-consultant": [
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeFable,
      variant: "max",
    },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "max",
    },
    {
      providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.kimi,
      variant: "max",
    }
  ],
  "plan-reviewer": [
    { providers: ["chatgpt-subscription", "openai"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "xhigh" },
    { providers: ["github-copilot"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "high" },
    { providers: ["chatgpt-subscription", "openai", "opencode"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "high" },
    {
      providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.claudeOpus,
      variant: "max",
    },
    {
      providers: ["google", "google-vertex", "opencode"],
      model: LATEST_MODEL_BY_FAMILY.geminiPro,
      variant: "high",
    },
    {
      providers: ["google", "github-copilot", "opencode"],
      model: "gemini-3.1-pro",
      variant: "high",
    },
    { providers: ["opencode-go"], model: "glm-5.2" }
  ],
}
