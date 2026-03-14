#!/usr/bin/env bun
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"
const DIST_SCHEMA_OUTPUT_PATH = "dist/oh-my-opencode.schema.json"
const OPENAGENT_SCHEMA_OUTPUT_PATH = "assets/oh-my-openagent.schema.json"
const OPENAGENT_DIST_SCHEMA_OUTPUT_PATH = "dist/oh-my-openagent.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const finalSchema = createOhMyOpenCodeJsonSchema()

  // oh-my-opencode schema (backward compatibility)
  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))
  await Bun.write(DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  // oh-my-openagent schema (new name)
  const openAgentSchema = {
    ...finalSchema,
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-openagent.schema.json",
    title: "Oh My OpenAgent Configuration",
    description: "Configuration schema for oh-my-openagent plugin",
  }
  await Bun.write(OPENAGENT_SCHEMA_OUTPUT_PATH, JSON.stringify(openAgentSchema, null, 2))
  await Bun.write(OPENAGENT_DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(openAgentSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
  console.log(`✓ JSON Schema generated: ${OPENAGENT_SCHEMA_OUTPUT_PATH}`)
}

main()
