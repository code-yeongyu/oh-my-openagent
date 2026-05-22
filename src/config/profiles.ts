import type { MatrixxConfig } from "./schema/matrixx-config"

export const PROFILE_NAMES = ["free", "budget", "economy", "balanced", "performance"] as const
export type ProfileName = (typeof PROFILE_NAMES)[number]

const OPUS = "anthropic/claude-opus-4-6"
const SONNET = "anthropic/claude-sonnet-4-6"
const HAIKU = "anthropic/claude-haiku-4-5"

const KIMI_FREE = "opencode/kimi-k2.5-free"
const GROK_FREE = "xai/grok-code-fast-1"
const GLM_CHEAP = "zai-coding-plan/glm-4.7"
const GEMINI_PRO = "gemini-3.1-pro"
const MINIMAX_FREE = "minimax-m2.5-free"

const PROFILES: Record<ProfileName, Partial<MatrixxConfig>> = {
  /* Use only free/zero-cost models. Best for experimentation, quick prototyping,
   * or when API credits are depleted. Agents use Kimi K2.5 Free, Grok (free tier),
   * Gemini, GLM, and MiniMax — no Claude or paid OpenAI models. */
  free: {
    agents: {
      morpheus: { model: KIMI_FREE },
      keymaker: { model: KIMI_FREE },
      oracle: { model: KIMI_FREE },
      seraph: { model: KIMI_FREE },
      cipher: { model: KIMI_FREE },
      niobe: { model: KIMI_FREE },
      sentinel: { model: KIMI_FREE },
      architect: { model: KIMI_FREE },
      smith: { model: GEMINI_PRO },
      merovingian: { model: GEMINI_PRO },
      operator: { model: GLM_CHEAP },
      trinity: { model: GROK_FREE },
      construct: { model: KIMI_FREE },
      mouse: { model: MINIMAX_FREE },
      zion: { model: MINIMAX_FREE },
    },
    categories: {
      source: { model: KIMI_FREE },
      "deep-jack": { model: KIMI_FREE },
      "matrix-bend": { model: KIMI_FREE },
      "red-pill": { model: KIMI_FREE },
      construct: { model: KIMI_FREE },
      "blue-pill": { model: MINIMAX_FREE },
      broadcast: { model: GEMINI_PRO },
      "bullet-time": { model: MINIMAX_FREE },
    },
  },

  budget: {
    agents: {
      morpheus: { model: SONNET },
      oracle: { model: HAIKU },
      cipher: { model: HAIKU },
      niobe: { model: HAIKU },
      sentinel: { model: HAIKU },
      seraph: { model: HAIKU },
      merovingian: { model: HAIKU },
      smith: { model: HAIKU },
      architect: { model: HAIKU },
      construct: { model: HAIKU },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
    },
    categories: {
      source: { model: SONNET },
      "deep-jack": { model: HAIKU },
      "matrix-bend": { model: HAIKU },
      construct: { model: HAIKU },
      "red-pill": { model: SONNET },
      "blue-pill": { model: HAIKU },
      broadcast: { model: HAIKU },
      "bullet-time": { model: HAIKU },
    },
  },

  economy: {
    agents: {
      morpheus: { model: SONNET },
      oracle: { model: SONNET },
      cipher: { model: SONNET },
      niobe: { model: SONNET },
      sentinel: { model: SONNET },
      seraph: { model: SONNET },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: HAIKU },
      construct: { model: HAIKU },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
    },
    categories: {
      source: { model: SONNET },
      "deep-jack": { model: SONNET },
      "matrix-bend": { model: SONNET },
      construct: { model: SONNET },
      "red-pill": { model: SONNET },
      "blue-pill": { model: SONNET },
      broadcast: { model: HAIKU },
      "bullet-time": { model: HAIKU },
    },
  },

  balanced: {
    agents: {
      morpheus: { model: OPUS },
      oracle: { model: SONNET },
      cipher: { model: SONNET },
      niobe: { model: SONNET },
      sentinel: { model: SONNET },
      seraph: { model: OPUS },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: SONNET },
      construct: { model: SONNET },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
    },
    categories: {
      source: { model: OPUS },
      "deep-jack": { model: SONNET },
      "matrix-bend": { model: SONNET },
      construct: { model: SONNET },
      "red-pill": { model: OPUS },
      "blue-pill": { model: SONNET },
      broadcast: { model: SONNET },
      "bullet-time": { model: HAIKU },
    },
  },

  performance: {
    agents: {
      morpheus: { model: OPUS },
      oracle: { model: OPUS },
      cipher: { model: OPUS },
      niobe: { model: OPUS },
      sentinel: { model: OPUS },
      seraph: { model: OPUS },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: SONNET },
      construct: { model: SONNET },
      trinity: { model: HAIKU },
      operator: { model: SONNET },
    },
    categories: {
      source: { model: OPUS },
      "deep-jack": { model: OPUS },
      "matrix-bend": { model: OPUS },
      construct: { model: OPUS },
      "red-pill": { model: OPUS },
      "blue-pill": { model: SONNET },
      broadcast: { model: SONNET },
      "bullet-time": { model: HAIKU },
    },
  },
}

export function expandProfile(profile: ProfileName): Partial<MatrixxConfig> {
  return PROFILES[profile]
}
