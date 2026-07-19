import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

// Source of truth mirrored from packages/model-core/src/agent-model-requirements.ts.
// senpi-task cannot import model-core here without adding a package dependency outside this task's scope.
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly DelegateFallbackEntry[]>> = {
  explore: [
    { providers: ["openai"], model: "gpt-5.4-mini-fast" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
    { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
    { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
  ],
  librarian: [
    { providers: ["openai"], model: "gpt-5.4-mini-fast" },
    { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
    { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
    { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
    { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
    { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
    { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
  ],
  metis: [
    { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
    { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-7", variant: "max" },
    { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "high" },
    { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    { providers: ["kimi-for-coding"], model: "k2p5" },
  ],
  momus: [
    { providers: ["openai", "vercel"], model: "gpt-5.6-terra", variant: "high" },
    { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "high" },
    { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "xhigh" },
    { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-7", variant: "max" },
    { providers: ["google", "github-copilot", "opencode", "vercel"], model: "gemini-3.1-pro", variant: "high" },
    { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
  ],
  oracle: [
    { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "high" },
    { providers: ["google", "github-copilot", "opencode", "vercel"], model: "gemini-3.1-pro", variant: "high" },
    { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-7", variant: "max" },
    { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
  ],
}
