import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/agent-model-requirements.ts.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  explore: [
    { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
  ],
  librarian: [
    { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
    { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["opencode-go"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go"], model: "minimax-m2.7" },
    { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
    { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
  ],
  metis: [
    { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
    {
      providers: ["anthropic", "github-copilot", "opencode"],
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
  momus: [
    { providers: ["openai", "openai-codex"], model: "gpt-5.6-terra", variant: "high" },
    { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "high" },
    { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
    { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
    {
      providers: ["anthropic", "github-copilot", "opencode"],
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
