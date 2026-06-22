#!/usr/bin/env bun
import * as z from "zod"
import { MatrixxConfigSchema } from "../src/config/schema"

const OUTPUT_PATH = "assets/matrixx.schema.json"

function buildSchema(targetId: string) {
  const jsonSchema = z.toJSONSchema(MatrixxConfigSchema, {
    target: "draft-7",
    unrepresentable: "any",
  })

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: targetId,
    title: "Matrixx Configuration",
    description: "Configuration schema for matrixx plugin",
    ...jsonSchema,
  }
}

async function main() {
  console.log("Generating JSON Schema...")

  const matrixxSchema = buildSchema(
    "https://raw.githubusercontent.com/klpanagi/matrixx/dev/assets/matrixx.schema.json",
  )
  await Bun.write(OUTPUT_PATH, JSON.stringify(matrixxSchema, null, 2))

  console.log(`✓ ${OUTPUT_PATH} regenerated`)
}

main()
