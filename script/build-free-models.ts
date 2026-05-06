import { writeFileSync } from "fs"
import { resolve } from "path"
import { MODELS_DEV_SOURCE_URL } from "../src/shared/model-capabilities-cache"
import { extractFreeOpenCodeModelIds } from "./free-model-extraction"

const OUTPUT_PATH = resolve(import.meta.dir, "../src/generated/free-opencode-models.generated.json")

console.log(`Fetching free opencode models from ${MODELS_DEV_SOURCE_URL}...`)
const response = await fetch(MODELS_DEV_SOURCE_URL)
if (!response.ok) {
  throw new Error(`models.dev fetch failed with ${response.status}`)
}

const raw = await response.json()
const freeModelIds = extractFreeOpenCodeModelIds(raw)
if (freeModelIds.length === 0) {
  throw new Error("No free opencode models found — models.dev schema may have changed")
}
const snapshot = {
  generatedAt: new Date().toISOString(),
  sourceUrl: MODELS_DEV_SOURCE_URL,
  providers: ["opencode"],
  models: freeModelIds,
}
writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Generated ${OUTPUT_PATH} with ${freeModelIds.length} free opencode models`)
