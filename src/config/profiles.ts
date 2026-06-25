import type { MatrixxConfig } from "./schema/matrixx-config"

export const PROFILE_NAMES = ["free", "budget", "economy", "balanced", "performance", "go", "xiaomi-ultimate", "go-ultimate", "go-trio", "go-duo"] as const
export type ProfileName = (typeof PROFILE_NAMES)[number]

const OPUS = "anthropic/claude-opus-4-6"
const SONNET = "anthropic/claude-sonnet-4-6"
const HAIKU = "anthropic/claude-haiku-4-5"

const KIMI_FREE = "opencode/kimi-k2.5-free"
const GROK_FREE = "xai/grok-code-fast-1"
const GLM_CHEAP = "zai-coding-plan/glm-4.7"

const MINIMAX_FREE = "minimax-m2.5-free"

const KIMI_K26 = "opencode-go/kimi-k2.6"
const DEEPSEEK_PRO = "opencode-go/deepseek-v4-pro"
const DEEPSEEK_FLASH = "opencode-go/deepseek-v4-flash"
const GLM_51 = "opencode-go/glm-5.1"
const MIMO_V25 = "opencode-go/mimo-v2.5"
const MINIMAX_M3 = "opencode-go/minimax-m3"

// Xiaomi Token Plan AMS provider models
const XIAOMI_MIMO_V25 = "xiaomi-token-plan-ams/mimo-v2.5"
const XIAOMI_MIMO_V25_PRO = "xiaomi-token-plan-ams/mimo-v2.5-pro"

const PROFILES: Record<ProfileName, Partial<MatrixxConfig>> = {
  /* Use only free/zero-cost models. Best for experimentation, quick prototyping,
   * or when API credits are depleted. Agents use Kimi K2.5 Free, Grok (free tier),
   * GLM, and MiniMax — no Claude, GPT, or Gemini paid models. */
  free: {
    agents: {
      morpheus: { model: KIMI_FREE },
      keymaker: { model: KIMI_FREE },
      oracle: { model: KIMI_FREE },
      seraph: { model: KIMI_FREE },
      cipher: { model: KIMI_FREE },
      sentinel: { model: KIMI_FREE },
      architect: { model: KIMI_FREE },
      smith: { model: KIMI_FREE },
      merovingian: { model: KIMI_FREE },
      operator: { model: GLM_CHEAP },
      trinity: { model: GROK_FREE },
      construct: { model: KIMI_FREE },
      mouse: { model: MINIMAX_FREE },
      sati: { model: KIMI_FREE },
    },
    categories: {
      source: { model: KIMI_FREE },
      "deep-jack": { model: KIMI_FREE },
      "matrix-bend": { model: KIMI_FREE },
      "red-pill": { model: KIMI_FREE },
      construct: { model: KIMI_FREE },
      "blue-pill": { model: MINIMAX_FREE },
      broadcast: { model: MINIMAX_FREE },
      "bullet-time": { model: MINIMAX_FREE },
    },
  },

  /* Optimized for OpenCode Go subscription: tiered model assignment maximizes
   * quota economics. Orchestrators (GLM-5.1) for planning, Deep Workers (Kimi K2.6)
   * for complex coding, QA (DeepSeek V4 Pro) for review, Automation (DeepSeek V4 Flash)
   * for lightweight tasks — stretching the 5-hour rolling budget furthest. */
  go: {
    agents: {
      /* Tier 1 — Orchestrators (Strategy & Planning): GLM-5.1 for long-horizon reasoning */
      morpheus: { model: GLM_51 },
      oracle: { model: GLM_51 },
      seraph: { model: GLM_51 },
      architect: { model: GLM_51 },
      /* Tier 2 — Deep Workers (Development & Implementation): Kimi K2.6 for complex code */
      keymaker: { model: KIMI_K26 },
      cipher: { model: KIMI_K26 },
      /* Tier 3 — QA/Review: DeepSeek V4 Pro for structured logic, test suites */
      sentinel: { model: DEEPSEEK_PRO },
      smith: { model: DEEPSEEK_PRO },
      merovingian: { model: DEEPSEEK_PRO },
      /* Tier 4 — Automation & Utility: DeepSeek V4 Flash (~31k requests/5h) */
      operator: { model: DEEPSEEK_FLASH },
      trinity: { model: DEEPSEEK_FLASH },
      construct: { model: DEEPSEEK_FLASH },
      mouse: { model: DEEPSEEK_FLASH },
      sati: { model: KIMI_K26 },
    },
    categories: {
      source: { model: KIMI_K26 },
      "deep-jack": { model: KIMI_K26 },
      "matrix-bend": { model: DEEPSEEK_PRO },
      "red-pill": { model: DEEPSEEK_PRO },
      construct: { model: DEEPSEEK_FLASH },
      "blue-pill": { model: DEEPSEEK_FLASH },
      broadcast: { model: DEEPSEEK_FLASH },
      "bullet-time": { model: DEEPSEEK_FLASH },
    },
  },

  budget: {
    agents: {
      morpheus: { model: SONNET },
      oracle: { model: HAIKU },
      cipher: { model: HAIKU },
      sentinel: { model: HAIKU },
      seraph: { model: HAIKU },
      merovingian: { model: HAIKU },
      smith: { model: HAIKU },
      architect: { model: HAIKU },
      construct: { model: HAIKU },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
      sati: { model: HAIKU },
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
      sentinel: { model: SONNET },
      seraph: { model: SONNET },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: HAIKU },
      construct: { model: HAIKU },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
      sati: { model: SONNET },
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
      sentinel: { model: SONNET },
      seraph: { model: OPUS },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: SONNET },
      construct: { model: SONNET },
      trinity: { model: HAIKU },
      operator: { model: HAIKU },
      sati: { model: SONNET },
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
      sentinel: { model: OPUS },
      seraph: { model: OPUS },
      merovingian: { model: SONNET },
      smith: { model: SONNET },
      architect: { model: SONNET },
      construct: { model: SONNET },
      trinity: { model: HAIKU },
      operator: { model: SONNET },
      sati: { model: OPUS },
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

  /* Ultimate configuration using Xiaomi Token Plan AMS provider models.
   * Tiered model assignment: mimo-v2.5-pro for heavy reasoning agents,
   * mimo-v2.5 for lightweight automation tasks. */
  "xiaomi-ultimate": {
    agents: {
      /* Tier 1 — Orchestrators & Deep Workers: mimo-v2.5-pro for complex reasoning */
      morpheus: { model: XIAOMI_MIMO_V25_PRO },
      oracle: { model: XIAOMI_MIMO_V25_PRO },
      seraph: { model: XIAOMI_MIMO_V25_PRO },

      architect: { model: XIAOMI_MIMO_V25_PRO },
      keymaker: { model: XIAOMI_MIMO_V25_PRO },
      cipher: { model: XIAOMI_MIMO_V25_PRO },
      sentinel: { model: XIAOMI_MIMO_V25_PRO },
      smith: { model: XIAOMI_MIMO_V25_PRO },
      merovingian: { model: XIAOMI_MIMO_V25_PRO },
      /* Tier 2 — Automation & Utility: mimo-v2.5 for lightweight tasks */
      operator: { model: XIAOMI_MIMO_V25 },
      trinity: { model: XIAOMI_MIMO_V25 },
      construct: { model: XIAOMI_MIMO_V25 },
      mouse: { model: XIAOMI_MIMO_V25 },
      sati: { model: XIAOMI_MIMO_V25_PRO },
    },
    categories: {
      source: { model: XIAOMI_MIMO_V25_PRO },
      "deep-jack": { model: XIAOMI_MIMO_V25_PRO },
      "matrix-bend": { model: XIAOMI_MIMO_V25_PRO },
      "red-pill": { model: XIAOMI_MIMO_V25_PRO },
      construct: { model: XIAOMI_MIMO_V25 },
      "blue-pill": { model: XIAOMI_MIMO_V25 },
      broadcast: { model: XIAOMI_MIMO_V25 },
      "bullet-time": { model: XIAOMI_MIMO_V25 },
    },
  },

  /* Ultimate configuration for OpenCode Go subscription. Uses the best available
   * models from the Go provider with no cost constraints. Pure performance mode
   * for users who want maximum capability from their Go subscription. */
  "go-ultimate": {
    agents: {
      morpheus: { model: KIMI_K26 },
      oracle: { model: KIMI_K26 },
      seraph: { model: KIMI_K26 },

      architect: { model: KIMI_K26 },
      keymaker: { model: KIMI_K26 },
      cipher: { model: KIMI_K26 },
      sentinel: { model: DEEPSEEK_PRO },
      smith: { model: DEEPSEEK_PRO },
      merovingian: { model: DEEPSEEK_PRO },
      operator: { model: DEEPSEEK_PRO },
      trinity: { model: DEEPSEEK_PRO },
      construct: { model: DEEPSEEK_PRO },
      mouse: { model: DEEPSEEK_PRO },
      sati: { model: KIMI_K26 },
    },
    categories: {
      source: { model: KIMI_K26 },
      "deep-jack": { model: KIMI_K26 },
      "matrix-bend": { model: KIMI_K26 },
      "red-pill": { model: KIMI_K26 },
      construct: { model: DEEPSEEK_PRO },
      "blue-pill": { model: DEEPSEEK_PRO },
      broadcast: { model: DEEPSEEK_PRO },
      "bullet-time": { model: DEEPSEEK_PRO },
    },
  },
  /* Three-model sweet spot using deepseek-v4-flash, minimax-m3, and mimo-v2.5
   * from the OpenCode Go provider. Minimax-m3 (+128% growth, $2.40/M) handles
   * orchestration & strategy. Mimo-v2.5 (same price as flash at $0.28/M but
   * stronger reasoning) covers deep work. DeepSeek V4 Flash (#1 by usage, $0.28/M)
   * handles high-volume automation. */
  "go-trio": {
    agents: {
      /* Tier 1 — Orchestrators: minimax-m3 for top reasoning & planning */
      morpheus: { model: MINIMAX_M3 },
      oracle: { model: MINIMAX_M3 },
      seraph: { model: MINIMAX_M3 },
      architect: { model: MINIMAX_M3 },
      /* Tier 2 — Deep Workers: mimo-v2.5 — same $0.28/M as flash, stronger reasoning */
      keymaker: { model: MIMO_V25 },
      cipher: { model: MIMO_V25 },
      sentinel: { model: MIMO_V25 },
      smith: { model: MIMO_V25 },
      merovingian: { model: MIMO_V25 },
      /* Tier 3 — Automation: deepseek-v4-flash — #1 workhorse, 96% cache ratio */
      operator: { model: DEEPSEEK_FLASH },
      trinity: { model: DEEPSEEK_FLASH },
      construct: { model: DEEPSEEK_FLASH },
      mouse: { model: DEEPSEEK_FLASH },
      sati: { model: MIMO_V25 },
    },
    categories: {
      source: { model: MINIMAX_M3 },
      "deep-jack": { model: MINIMAX_M3 },
      "matrix-bend": { model: MINIMAX_M3 },
      "red-pill": { model: MIMO_V25 },
      construct: { model: DEEPSEEK_FLASH },
      "blue-pill": { model: DEEPSEEK_FLASH },
      broadcast: { model: DEEPSEEK_FLASH },
      "bullet-time": { model: DEEPSEEK_FLASH },
    },
  },

  /* go-duo — 2-model profile: deepseek-v4-flash for reasoning/analysis/DSL
     (incl. Sati — UI tradeoffs benefit from deeper reasoning),
     mimo-v2.5 for general code. The 9/5 split is intentional: deepseek
     covers 9 reasoning-heavy roles, mimo covers 5 general-code/utility
     roles. Self-contained: fallback chain stays within
     {mimo-v2.5, deepseek-v4-flash}. */
  "go-duo": {
    agents: {
      /* Tier 1 — Reasoning / analysis / DSL / UI: deepseek-v4-flash (9 agents) */
      morpheus: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      oracle: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      seraph: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      architect: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      merovingian: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      smith: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      cipher: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      sentinel: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      sati: {
        model: DEEPSEEK_FLASH,
        fallbackChain: [{ providers: ["opencode-go"], model: MIMO_V25 }],
      },
      /* Tier 2 — General code: mimo-v2.5 (5 agents) */
      keymaker: {
        model: MIMO_V25,
        fallbackChain: [{ providers: ["opencode-go"], model: DEEPSEEK_FLASH }],
      },
      trinity: {
        model: MIMO_V25,
        fallbackChain: [{ providers: ["opencode-go"], model: DEEPSEEK_FLASH }],
      },
      construct: {
        model: MIMO_V25,
        fallbackChain: [{ providers: ["opencode-go"], model: DEEPSEEK_FLASH }],
      },
      operator: {
        model: MIMO_V25,
        fallbackChain: [{ providers: ["opencode-go"], model: DEEPSEEK_FLASH }],
      },
      mouse: {
        model: MIMO_V25,
        fallbackChain: [{ providers: ["opencode-go"], model: DEEPSEEK_FLASH }],
      },
    },
    categories: {
      source: { model: DEEPSEEK_FLASH },
      "deep-jack": { model: DEEPSEEK_FLASH },
      "matrix-bend": { model: MIMO_V25 },
      "red-pill": { model: DEEPSEEK_FLASH },
      construct: { model: MIMO_V25 },
      "blue-pill": { model: MIMO_V25 },
      broadcast: { model: MIMO_V25 },
      "bullet-time": { model: MIMO_V25 },
    },
  },
}

export function expandProfile(profile: ProfileName): Partial<MatrixxConfig> {
  return PROFILES[profile]
}
