#!/usr/bin/env bun
import * as z from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { MatrixxConfigSchema } from "../src/config/schema"

const SCHEMA_OUTPUT_PATH = "assets/matrixx.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const jsonSchema = zodToJsonSchema(MatrixxConfigSchema, {
    target: "draft7",
  })

  const finalSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/matrixx.schema.json",
    title: "Matrixx Configuration",
    description: "Configuration schema for matrixx plugin",
    ...jsonSchema,
  }

  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
