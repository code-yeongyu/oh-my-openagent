#!/usr/bin/env bun
import { z } from "zod"
import { DoctorResultSchema as DoctorSchema } from "../packages/omo-opencode/src/help/schema/doctor"
import { StatusResultSchema as StatusSchema } from "../packages/omo-opencode/src/help/schema/status"
import { SandboxResultSchema as SandboxSchema } from "../packages/omo-opencode/src/help/schema/sandbox"
import { AcpResultSchema as AcpSchema } from "../packages/omo-opencode/src/help/schema/acp"

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
  {
    name: "status",
    schema: StatusSchema,
    title: "System Status",
    description: "JSON schema for oh-my-openagent system status output",
    id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/help/status.schema.json",
  },
  {
    name: "sandbox",
    schema: SandboxSchema,
    title: "Sandbox Environment",
    description: "JSON schema for oh-my-openagent sandbox execution environment output",
    id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/help/sandbox.schema.json",
  },
  {
    name: "acp",
    schema: AcpSchema,
    title: "ACP Server Status",
    description: "JSON schema for oh-my-openagent Agent Control Protocol server output",
    id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/help/acp.schema.json",
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
