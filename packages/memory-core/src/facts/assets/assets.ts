import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { loadPersonaAsset } from "../../personas/load"

const ASSETS_DIR = dirname(fileURLToPath(import.meta.url))

export function loadFactsPersona(): string {
  return loadPersonaAsset(ASSETS_DIR, "facts")
}
