// Every consumer of a persona filename - the loaders beside each asset, the plugin staging script
// and the packing validators - must derive it from this record, so one rename cannot leave a
// reference pointing at an asset that no longer ships.
export const PERSONA_ASSET_FILENAMES = {
  reflection: "reflection-persona.md",
  dream: "dream-persona.md",
  facts: "facts-persona.md",
  kibitzer: "kibitzer-persona.md",
} as const

export type PersonaAssetKind = keyof typeof PERSONA_ASSET_FILENAMES

export const PERSONA_ASSET_FILES: readonly string[] = [
  PERSONA_ASSET_FILENAMES.reflection,
  PERSONA_ASSET_FILENAMES.dream,
  PERSONA_ASSET_FILENAMES.facts,
  PERSONA_ASSET_FILENAMES.kibitzer,
]
