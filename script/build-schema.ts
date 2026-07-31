#!/usr/bin/env bun
import { createOmoJsonSchema } from "./build-omo-schema-document"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const OMO_SCHEMA_OUTPUT_PATH = "assets/omo.schema.json"
const LEGACY_SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"
const DIST_SCHEMA_OUTPUT_PATH = "dist/oh-my-opencode.schema.json"

async function main() {
  console.log("Generating JSON Schemas...")

  await Bun.write(OMO_SCHEMA_OUTPUT_PATH, JSON.stringify(createOmoJsonSchema(), null, 2))

  const legacySchema = createOhMyOpenCodeJsonSchema()
  await Bun.write(LEGACY_SCHEMA_OUTPUT_PATH, JSON.stringify(legacySchema, null, 2))
  await Bun.write(DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(legacySchema, null, 2))

  console.log(`✓ JSON Schemas generated: ${OMO_SCHEMA_OUTPUT_PATH}, ${LEGACY_SCHEMA_OUTPUT_PATH}`)
}

main()
