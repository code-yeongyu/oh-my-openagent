export type FallbackEntry = {
  providers: string[]
  model: string
  variant?: string // Entry-specific variant (e.g., GPT→high, Opus→max)
}

export type ModelRequirement = {
  fallbackChain: FallbackEntry[]
  variant?: string // Default variant (used when entry doesn't specify one)
  requiresModel?: string // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: string[] // If set, only activates when any of these providers is connected
}

function fb(providers: string[] | string, model: string, variant?: string): FallbackEntry {
  return {
    providers: Array.isArray(providers) ? providers : [providers],
    model,
    ...(variant !== undefined ? { variant } : {}),
  }
}

function dedupeChain(chain: FallbackEntry[]): FallbackEntry[] {
  const seen = new Set<string>()
  const result: FallbackEntry[] = []
  for (const entry of chain) {
    const key = `${entry.model}:${entry.variant ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result
}

// Provider preference rules:
// - Never use the paid `opencode` provider as an automatic fallback.
// - Prefer `quotio` when the same model exists across multiple providers.
// - Prefer `github-copilot` first for `gpt-5-mini` (unlimited), fall back to `quotio`.
// Note: user requested "Quotio-first" and to avoid the OpenCode provider; we keep runtime fallbacks on
// `quotio` + `nvidia` (+ `github-copilot` for unlimited GPT mini) unless explicitly requested otherwise.
const P_GPT: string[] = ["quotio"]
const P_GPT_MINI: string[] = ["github-copilot", "quotio"]

// Benchmark-driven ordering (user-provided table + NVIDIA NIM docs), tuned per-agent for quality vs speed.

const SPEED_CHAIN: FallbackEntry[] = [
  fb("quotio", "claude-haiku-4-5"), fb("quotio", "oswe-vscode-prime"),
  fb(P_GPT_MINI, "gpt-5-mini", "high"), fb(P_GPT_MINI, "gpt-4.1"),
  fb("nvidia", "nvidia/nemotron-3-nano-30b-a3b"), fb("quotio", "iflow-rome-30ba3b"),
  fb("minimax-coding-plan", "MiniMax-M2.5"), fb("nvidia", "bytedance/seed-oss-36b-instruct"),
  fb("quotio", "claude-sonnet-4-5"),
]

const QUALITY_CODING_CHAIN: FallbackEntry[] = [
  fb("quotio", "claude-opus-4-6-thinking"),
  fb("nvidia", "stepfun-ai/step-3.5-flash"),
  fb("nvidia", "qwen/qwen3.5-397b-a17b"),
  fb("quotio", "glm-5"),
  fb("nvidia", "z-ai/glm5"),
  fb("quotio", "deepseek-v3.2-reasoner"),
  fb("quotio", "deepseek-r1"),
  fb("nvidia", "deepseek-ai/deepseek-r1"),
  fb("quotio", "qwen3-235b-a22b-thinking-2507"),
  fb("nvidia", "qwen/qwen3-next-80b-a3b-thinking"),
  fb("nvidia", "qwen/qwen3-coder-480b-a35b-instruct"),
  fb("nvidia", "bytedance/seed-oss-36b-instruct"),
  fb("quotio", "kimi-k2-thinking"),
  fb("quotio", "kimi-k2.5"),
  fb("nvidia", "moonshotai/kimi-k2.5"),
  fb("minimax-coding-plan", "MiniMax-M2.5"),
  fb("minimax-coding-plan", "MiniMax-M2.5-highspeed"),
  fb("minimax", "MiniMax-M2.5"),
  fb("quotio", "minimax-m2.5"),
  fb("quotio", "claude-sonnet-4-5-thinking"),
]

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      // 1st fallback: switch away from Opus Thinking to the non-thinking model (often more available).
      fb("quotio", "claude-opus-4-6", "max"),
      // 2nd fallback: user-requested.
      fb("quotio", "gpt-5.3-codex", "high"),
      ...QUALITY_CODING_CHAIN,
      ...SPEED_CHAIN,
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      fb("quotio", "gpt-5.3-codex", "high"),
      ...QUALITY_CODING_CHAIN,
    ],
    requiresAnyModel: true,
  },
  oracle: {
    fallbackChain: dedupeChain([
      fb("quotio", "gpt-5.3-codex", "high"),
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  librarian: {
    fallbackChain: [
      fb("quotio", "claude-sonnet-4-5"),
      ...SPEED_CHAIN,
      ...QUALITY_CODING_CHAIN,
    ],
  },
  explore: {
    fallbackChain: SPEED_CHAIN,
  },
  "multimodal-looker": {
    fallbackChain: [
      fb("quotio", "gemini-3-pro-image"),
      fb("quotio", "gemini-3-pro-high"),
      fb("quotio", "gemini-3-flash"),
      fb("quotio", "kimi-k2.5"),
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      fb("quotio", "claude-haiku-4-5"),
    ],
  },
  prometheus: {
    fallbackChain: dedupeChain([
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "gpt-5.3-codex", "high"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  metis: {
    fallbackChain: dedupeChain([
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "gpt-5.3-codex", "high"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  momus: {
    fallbackChain: dedupeChain([
      fb("quotio", "gpt-5.3-codex", "high"),
      fb("quotio", "claude-opus-4-6-thinking"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  atlas: {
    fallbackChain: dedupeChain([
      fb("quotio", "claude-sonnet-4-5-thinking"),
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "gpt-5.3-codex", "medium"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
}

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "gemini-3-pro-image"),
      fb("quotio", "kimi-k2-thinking"),
      fb("quotio", "kimi-k2.5"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      fb("quotio", "gpt-5.3-codex", "medium"),
    ],
  },
  ultrabrain: {
    fallbackChain: dedupeChain([
      fb("quotio", "gpt-5.3-codex", "high"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  deep: {
    fallbackChain: [
      fb("quotio", "gpt-5.3-codex", "medium"),
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      ...QUALITY_CODING_CHAIN,
    ],
    requiresModel: "gpt-5.3-codex",
  },
  artistry: {
    fallbackChain: [
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "claude-sonnet-4-5-thinking"),
      fb("quotio", "claude-sonnet-4-5"),
    ],
    requiresModel: "claude-opus-4-6",
  },
  quick: {
    fallbackChain: SPEED_CHAIN,
  },
  "unspecified-low": {
    fallbackChain: SPEED_CHAIN,
  },
  "unspecified-high": {
    fallbackChain: dedupeChain([
      fb("quotio", "claude-opus-4-6-thinking"),
      fb("quotio", "gpt-5.3-codex", "high"),
      ...QUALITY_CODING_CHAIN,
    ]),
  },
  writing: {
    fallbackChain: [
      fb("quotio", "claude-sonnet-4-5"),
      fb("quotio", "glm-5"),
      fb("quotio", "kimi-k2.5"),
      fb("quotio", "claude-haiku-4-5"),
      fb("quotio", "gemini-3-flash"),
    ],
  },
}
