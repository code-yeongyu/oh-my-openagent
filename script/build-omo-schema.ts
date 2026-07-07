#!/usr/bin/env bun
import { createOmoJsonSchema } from "./build-omo-schema-document"

const SCHEMA_OUTPUT_PATH = "assets/omo.schema.json"

async function main() {
  console.log("Generating omo JSON Schema...")

  const finalSchema = createOmoJsonSchema()
  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  console.log(`✓ omo JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
