import { writeFileSync } from "fs"
import { resolve } from "path"
import {
  fetchModelCapabilitiesSnapshot,
  MODELS_DEV_SOURCE_URL,
} from "../packages/omo-opencode/src/shared/model-capabilities-cache"

const OUTPUT_PATH = resolve(import.meta.dir, "../packages/omo-opencode/src/generated/model-capabilities.generated.json")
const RETIRED_MODEL_ID_FRAGMENT = ["gpt", "5.4", "mini"].join("-")

console.log(`Fetching model capabilities snapshot from ${MODELS_DEV_SOURCE_URL}...`)
const snapshot = await fetchModelCapabilitiesSnapshot()
snapshot.models = Object.fromEntries(
  Object.entries(snapshot.models).filter(
    ([key, model]) =>
      !key.toLowerCase().includes(RETIRED_MODEL_ID_FRAGMENT) &&
      !model.id.toLowerCase().includes(RETIRED_MODEL_ID_FRAGMENT),
  ),
)
writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Generated ${OUTPUT_PATH} with ${Object.keys(snapshot.models).length} models`)
