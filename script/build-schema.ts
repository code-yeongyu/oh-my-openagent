#!/usr/bin/env bun
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const finalSchema = createOhMyOpenCodeJsonSchema()

  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
