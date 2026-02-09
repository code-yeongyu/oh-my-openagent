/**
 * Antigravity Provider Configuration
 *
 * IMPORTANT: Model names MUST use `antigravity-` prefix for stability.
 *
 * Since opencode-antigravity-auth v1.3.0, models use a variant system:
 * - `antigravity-gemini-3-pro` with variants: low, high
 * - `antigravity-gemini-3-flash` with variants: minimal, low, medium, high
 *
 * Legacy tier-suffixed names (e.g., `antigravity-gemini-3-pro-high`) still work
 * but variants are the recommended approach.
 *
 * @see https://github.com/NoeFabris/opencode-antigravity-auth#models
 */
export const ANTIGRAVITY_PROVIDER_CONFIG = {
  google: {
    name: "Google",
    models: {
      "antigravity-gemini-3-pro": {
        name: "Gemini 3 Pro (Antigravity)",
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" },
        },
      },
      "antigravity-gemini-3-flash": {
        name: "Gemini 3 Flash (Antigravity)",
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          minimal: { thinkingLevel: "minimal" },
          low: { thinkingLevel: "low" },
          medium: { thinkingLevel: "medium" },
          high: { thinkingLevel: "high" },
        },
      },
      "antigravity-claude-sonnet-4-5": {
        name: "Claude Sonnet 4.5 (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "antigravity-claude-sonnet-4-5-thinking": {
        name: "Claude Sonnet 4.5 Thinking (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingConfig: { thinkingBudget: 8192 } },
          max: { thinkingConfig: { thinkingBudget: 32768 } },
        },
      },
      "antigravity-claude-opus-4-5-thinking": {
        name: "Claude Opus 4.5 Thinking (Antigravity)",
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: {
          low: { thinkingConfig: { thinkingBudget: 8192 } },
          max: { thinkingConfig: { thinkingBudget: 32768 } },
        },
      },
    },
  },
}
