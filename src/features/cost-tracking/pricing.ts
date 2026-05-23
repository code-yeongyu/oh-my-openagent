import { ModelPrice } from "./types"

/**
 * Known model pricing database.
 * Prices are in USD per million tokens (input/output).
 * Source: official provider pricing pages as of May 2026.
 * Falls back to generic estimates for unknown models.
 */

const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic Claude
  "claude-sonnet-4-20250514": { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, currency: "USD", provider: "anthropic" },
  "claude-sonnet-4": { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, currency: "USD", provider: "anthropic" },
  "claude-3-5-sonnet-20241022": { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, currency: "USD", provider: "anthropic" },
  "claude-opus-4-20250514": { inputPerMillionTokens: 15.0, outputPerMillionTokens: 75.0, currency: "USD", provider: "anthropic" },
  "claude-3-haiku-20240307": { inputPerMillionTokens: 0.25, outputPerMillionTokens: 1.25, currency: "USD", provider: "anthropic" },

  // OpenAI
  "gpt-4o": { inputPerMillionTokens: 2.5, outputPerMillionTokens: 10.0, currency: "USD", provider: "openai" },
  "gpt-4o-mini": { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6, currency: "USD", provider: "openai" },
  "gpt-4.1": { inputPerMillionTokens: 2.0, outputPerMillionTokens: 8.0, currency: "USD", provider: "openai" },
  "o3-mini": { inputPerMillionTokens: 1.1, outputPerMillionTokens: 4.4, currency: "USD", provider: "openai" },

  // DeepSeek
  "deepseek-v4-flash": { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6, currency: "USD", provider: "deepseek" },
  "deepseek-v3": { inputPerMillionTokens: 0.27, outputPerMillionTokens: 1.1, currency: "USD", provider: "deepseek" },
  "deepseek-r1": { inputPerMillionTokens: 0.55, outputPerMillionTokens: 2.19, currency: "USD", provider: "deepseek" },

  // Google
  "gemini-2.5-flash": { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6, currency: "USD", provider: "google" },
  "gemini-2.5-pro": { inputPerMillionTokens: 1.25, outputPerMillionTokens: 5.0, currency: "USD", provider: "google" },

  // Kimi
  "kimi-k2.6": { inputPerMillionTokens: 0.45, outputPerMillionTokens: 1.8, currency: "USD", provider: "moonshot" },

  // Grok / xAI
  "grok-4.1": { inputPerMillionTokens: 2.0, outputPerMillionTokens: 10.0, currency: "USD", provider: "xai" },

  // OpenRouter generic fallbacks
  "openrouter/default": { inputPerMillionTokens: 0.5, outputPerMillionTokens: 2.0, currency: "USD", provider: "openrouter" },
}

/** Generic fallback for unknown models */
const GENERIC_PRICE: ModelPrice = { inputPerMillionTokens: 1.0, outputPerMillionTokens: 4.0, currency: "USD", provider: "unknown" }

let customPrices: Record<string, ModelPrice> = {}

export function getModelPrice(modelId: string): ModelPrice {
  return customPrices[modelId] ?? MODEL_PRICES[modelId] ?? GENERIC_PRICE
}

export function setCustomPrice(modelId: string, price: ModelPrice): void {
  customPrices[modelId] = price
}

export function getAllPrices(): Record<string, ModelPrice> {
  return { ...MODEL_PRICES, ...customPrices }
}

export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = getModelPrice(modelId)
  const inputCost = (inputTokens / 1_000_000) * price.inputPerMillionTokens
  const outputCost = (outputTokens / 1_000_000) * price.outputPerMillionTokens
  return Number((inputCost + outputCost).toFixed(6))
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}
