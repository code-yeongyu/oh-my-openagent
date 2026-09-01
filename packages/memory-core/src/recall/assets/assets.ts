import { readFileSync } from "../../fs/resilient"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// import.meta.dir is Bun-only: the senpi extension bundle loads under plain Node through jiti, where
// it is undefined. jiti rewrites import.meta.url to the real file URL, so the standard ESM idiom
// works on every runtime (same reason as reflection/assets/assets.ts).
const ASSETS_DIR = dirname(fileURLToPath(import.meta.url))

export function loadMemorianPersona(): string {
  return readFileSync(join(ASSETS_DIR, "memorian-persona.md"), "utf8")
}
