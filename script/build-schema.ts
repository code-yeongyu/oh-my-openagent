#!/usr/bin/env bun
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"
const DIST_SCHEMA_OUTPUT_PATH = "dist/oh-my-opencode.schema.json"
const BETTER_SCHEMA_OUTPUT_PATH = "assets/better-oh-my-opencode.schema.json"
const BETTER_DIST_SCHEMA_OUTPUT_PATH = "dist/better-oh-my-opencode.schema.json"

/** Better-OMO-only agent keys that should not appear in the upstream OMO schema */
const BETTER_ONLY_AGENTS = ["argus"]

function stripBetterOnlyAgents(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(schema)
  const agents = (clone as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
    ?.properties?.agents?.properties
  if (agents) {
    for (const key of BETTER_ONLY_AGENTS) {
      delete agents[key]
    }
  }
  return clone
}

async function main() {
  console.log("Generating JSON Schema...")

  const fullSchema = createOhMyOpenCodeJsonSchema()

  // Better OMO schema — full, includes argus and any future better-omo-only agents
  const betterSchema = {
    ...fullSchema,
    $id: fullSchema.$id?.toString().replace("oh-my-opencode.schema.json", "better-oh-my-opencode.schema.json"),
    title: "Better Oh My OpenCode Configuration",
    description: "Configuration schema for better-oh-my-opencode plugin",
  }
  await Bun.write(BETTER_SCHEMA_OUTPUT_PATH, JSON.stringify(betterSchema, null, 2))
  await Bun.write(BETTER_DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(betterSchema, null, 2))
  console.log(`✓ Better OMO Schema generated: ${BETTER_SCHEMA_OUTPUT_PATH}`)

  // OMO schema — upstream-clean, no better-omo-only agents
  const omoSchema = stripBetterOnlyAgents(fullSchema)
  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(omoSchema, null, 2))
  await Bun.write(DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(omoSchema, null, 2))
  console.log(`✓ OMO Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
