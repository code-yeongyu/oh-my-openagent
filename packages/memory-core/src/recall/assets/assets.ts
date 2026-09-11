import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { loadPersonaAsset } from "../../personas/load"

// import.meta.dir is Bun-only: the senpi extension bundle loads under plain Node through jiti, where
// it is undefined. jiti rewrites import.meta.url to the real file URL, so the standard ESM idiom
// works on every runtime (same reason as reflection/assets/assets.ts).
const ASSETS_DIR = dirname(fileURLToPath(import.meta.url))

export function loadKibitzerPersona(): string {
  return loadPersonaAsset(ASSETS_DIR, "kibitzer")
}
