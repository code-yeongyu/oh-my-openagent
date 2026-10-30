import { describe, expect, test } from "bun:test"

import { AGENT_FALLBACK_CHAINS } from "./fallback-chains"
import { FABLE_55_RELEASED } from "@oh-my-opencode/model-core"

// Coupling guard: this test file must NEVER import chain data from @oh-my-opencode/model-core. The one
// allowed import is the FABLE_55_RELEASED launch switch, which gates the literal provisional 5.5 rows.
// The chains are a hand transcription; the pins below catch transcription drift.

describe("AGENT_FALLBACK_CHAINS", () => {
  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(AGENT_FALLBACK_CHAINS).toEqual({
      explore: [
        { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m2.7" }
      ],
      librarian: [
        { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m2.7" }
      ],
      "plan-consultant": [
        ...(FABLE_55_RELEASED ? [{ providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-fable-5-5", variant: "max" }] : []),
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["opencode-go", "kimi-for-coding", "moonshotai"], model: "kimi-k3.1-pro", variant: "max" },
        { providers: ["opencode"], model: "kimi-k3", variant: "max" }
      ],
      "plan-reviewer": [
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-astra", variant: "xhigh" },
        { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
        { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-6-astra", variant: "high" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["google", "google-vertex", "opencode"], model: "gemini-4-argon", variant: "high" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["opencode-go"], model: "glm-5.2" }
      ]
    })
  })

})
