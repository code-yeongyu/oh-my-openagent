import { writeFileSync } from "fs"
import { resolve } from "path"
import {
  fetchModelCapabilitiesSnapshot,
  MODELS_DEV_SOURCE_URL,
} from "../src/shared/model-capabilities-cache"

const OUTPUT_PATH = resolve(import.meta.dir, "../src/generated/model-capabilities.generated.json")

console.log(`Fetching model capabilities snapshot from ${MODELS_DEV_SOURCE_URL}...`)
const snapshot = await fetchModelCapabilitiesSnapshot()
writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Generated ${OUTPUT_PATH} with ${Object.keys(snapshot.models).length} models`)
