import { readFileSync } from "../../fs/resilient"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ASSETS_DIR = dirname(fileURLToPath(import.meta.url))

export function loadFactsPersona(): string {
  return readFileSync(join(ASSETS_DIR, "facts-persona.md"), "utf8")
}
