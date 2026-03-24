import type { MatrixxConfig } from "./schema/matrixx-config"

export const PROFILE_NAMES = ["budget", "economy", "balanced", "performance"] as const
export type ProfileName = (typeof PROFILE_NAMES)[number]

const OPUS = "google-vertex-anthropic/claude-opus-4-6@default"
const SONNET = "google-vertex-anthropic/claude-sonnet-4-6@default"
const HAIKU = "google-vertex-anthropic/claude-haiku-4-5@20251001"
const GEMINI_PRO = "google-vertex/gemini-3.1-pro-preview"
const GEMINI_FLASH = "google-vertex/gemini-3-flash-preview"
const GEMINI_FAST = "google-vertex/gemini-2.5-flash"

const PROFILES: Record<ProfileName, Partial<MatrixxConfig>> = {
  budget: {
    agents: {
      morpheus: { model: SONNET },
      oracle: { model: GEMINI_PRO },
      cipher: { model: GEMINI_PRO },
      niobe: { model: GEMINI_PRO },
      sentinel: { model: GEMINI_PRO },
      seraph: { model: GEMINI_PRO },
      merovingian: { model: GEMINI_PRO },
      smith: { model: GEMINI_PRO },
      architect: { model: GEMINI_FAST },
      construct: { model: GEMINI_FAST },
      trinity: { model: GEMINI_FAST },
      operator: { model: GEMINI_FAST },
    },
    categories: {
      source: { model: GEMINI_PRO },
      "dsl-engineering": { model: GEMINI_PRO },
      "deep-jack": { model: GEMINI_FAST },
      "matrix-bend": { model: GEMINI_FAST },
      construct: { model: GEMINI_FAST },
      "red-pill": { model: GEMINI_FAST },
      "blue-pill": { model: GEMINI_FAST },
      broadcast: { model: GEMINI_FAST },
      "bullet-time": { model: GEMINI_FAST },
    },
  },

  economy: {
    agents: {
      morpheus: { model: HAIKU },
      oracle: { model: HAIKU },
      cipher: { model: HAIKU },
      niobe: { model: HAIKU },
      sentinel: { model: HAIKU },
      seraph: { model: HAIKU },
      merovingian: { model: GEMINI_PRO },
      smith: { model: GEMINI_PRO },
      architect: { model: GEMINI_FLASH },
      construct: { model: GEMINI_FLASH },
      trinity: { model: GEMINI_FAST },
      operator: { model: GEMINI_FAST },
    },
    categories: {
      source: { model: HAIKU },
      "dsl-engineering": { model: HAIKU },
      "deep-jack": { model: GEMINI_PRO },
      "matrix-bend": { model: GEMINI_PRO },
      construct: { model: GEMINI_PRO },
      "red-pill": { model: GEMINI_PRO },
      "blue-pill": { model: HAIKU },
      broadcast: { model: GEMINI_FLASH },
      "bullet-time": { model: GEMINI_FAST },
    },
  },

  balanced: {
    agents: {
      morpheus: { model: OPUS },
      oracle: { model: SONNET },
      cipher: { model: SONNET },
      niobe: { model: SONNET },
      sentinel: { model: SONNET },
      seraph: { model: SONNET },
      merovingian: { model: GEMINI_PRO },
      smith: { model: GEMINI_PRO },
      architect: { model: GEMINI_FLASH },
      construct: { model: GEMINI_FLASH },
      trinity: { model: GEMINI_FAST },
      operator: { model: GEMINI_FAST },
    },
    categories: {
      source: { model: SONNET },
      "dsl-engineering": { model: SONNET },
      "deep-jack": { model: GEMINI_PRO },
      "matrix-bend": { model: GEMINI_PRO },
      construct: { model: GEMINI_PRO },
      "red-pill": { model: GEMINI_PRO },
      "blue-pill": { model: SONNET },
      broadcast: { model: GEMINI_FLASH },
      "bullet-time": { model: GEMINI_FAST },
    },
  },

  performance: {
    agents: {
      morpheus: { model: OPUS },
      oracle: { model: OPUS },
      cipher: { model: OPUS },
      niobe: { model: OPUS },
      sentinel: { model: OPUS },
      seraph: { model: SONNET },
      merovingian: { model: GEMINI_PRO },
      smith: { model: GEMINI_PRO },
      architect: { model: GEMINI_FLASH },
      construct: { model: GEMINI_FLASH },
      trinity: { model: GEMINI_FAST },
      operator: { model: GEMINI_FAST },
    },
    categories: {
      source: { model: OPUS },
      "dsl-engineering": { model: OPUS },
      "deep-jack": { model: GEMINI_PRO },
      "matrix-bend": { model: GEMINI_PRO },
      construct: { model: GEMINI_PRO },
      "red-pill": { model: GEMINI_PRO },
      "blue-pill": { model: SONNET },
      broadcast: { model: GEMINI_FLASH },
      "bullet-time": { model: GEMINI_FAST },
    },
  },
}

export function expandProfile(profile: ProfileName): Partial<MatrixxConfig> {
  return PROFILES[profile]
}
