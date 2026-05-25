#!/usr/bin/env bun
import { z } from "zod"
import { DoctorResultSchema as DoctorSchema } from "../src/help/schema/doctor"

const SCHEMA_OUTPUT_DIR = "assets/help"

interface SchemaEntry {
  name: string
  schema: z.ZodType
  title: string
  description: string
  id: string
}

async function writeJsonSchema(entry: SchemaEntry): Promise<void> {
  const jsonSchema = z.toJSONSchema(entry.schema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>

  const output = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: entry.id,
    title: entry.title,
    description: entry.description,
    ...jsonSchema,
  }

  const filePath = `${SCHEMA_OUTPUT_DIR}/${entry.name}.schema.json`
  await Bun.write(filePath, JSON.stringify(output, null, 2))
  console.log(`  ✓ ${entry.name}.schema.json`)
}

const SCHEMAS: SchemaEntry[] = [
  {
    name: "doctor",
    schema: DoctorSchema,
    title: "Doctor Diagnostic Result",
    description: "JSON schema for oh-my-openagent doctor diagnostic output",
    id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/help/doctor.schema.json",
  },
]

async function main() {
  console.log("Generating Help JSON Schemas...\n")
  for (const entry of SCHEMAS) {
    await writeJsonSchema(entry)
  }
  console.log(`\nDone — ${SCHEMAS.length} schema(s) generated in ${SCHEMA_OUTPUT_DIR}/`)
}

main()
