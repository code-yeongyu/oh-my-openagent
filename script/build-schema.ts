#!/usr/bin/env bun
import { z } from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

const SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    unrepresentable: "any",
    override: (_ctx) => undefined,
  })

  const finalSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
    title: "Oh My OpenCode Configuration",
    description: "Configuration schema for oh-my-opencode plugin",
    ...jsonSchema,
  }

  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
