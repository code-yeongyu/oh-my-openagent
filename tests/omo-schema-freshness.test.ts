import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import Ajv from "ajv"
import { OmoConfigSchema } from "../packages/omo-config-core/src/schema"
import { createOmoJsonSchema } from "../script/build-omo-schema-document"

const REPO_ROOT = join(import.meta.dir, "..")
const SCHEMA_PATH = join(REPO_ROOT, "assets", "omo.schema.json")
const DOC_PATH = join(REPO_ROOT, "docs", "reference", "omo-json.md")

function extractSchemaExample(markdown: string): unknown {
  const fences = markdown.match(/```json\n([\s\S]*?)```/g) ?? []
  for (const fence of fences) {
    const body = fence.replace(/```json\n/, "").replace(/```$/, "")
    if (body.includes("\"$schema\"")) return JSON.parse(body)
  }
  throw new Error("no $schema-bearing json example found in omo-json.md")
}

function createCommittedSchemaValidator(): ReturnType<Ajv["compile"]> {
  const schema: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"))
  if (typeof schema !== "object" || schema === null) {
    throw new Error("assets/omo.schema.json must contain a JSON object")
  }
  return new Ajv({ strict: true }).compile(schema)
}

describe("omo schema freshness", () => {
  test("#given the current Zod schema #when regenerated #then it matches the committed artifact", () => {
    // given
    const committed = readFileSync(SCHEMA_PATH, "utf-8")

    // when
    const regenerated = JSON.stringify(createOmoJsonSchema(), null, 2)

    // then
    expect(regenerated).toBe(committed)
  })

  test("#given the docs example omo.json #when parsed by OmoConfigSchema #then it validates", () => {
    // given
    const example = extractSchemaExample(readFileSync(DOC_PATH, "utf-8"))

    // when
    const result = OmoConfigSchema.safeParse(example)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
  })

  test("#given a minimal task opt-out #when validated by the shipped schema #then defaulted siblings remain optional", () => {
    // given
    const validate = createCommittedSchemaValidator()
    const config = { task: { reattach_on_reconcile: false } }

    // when
    const valid = validate(config)

    // then
    if (!valid) throw new Error(JSON.stringify(validate.errors))
    expect(valid).toBe(true)
  })

  test("#given the documented partial omo.json #when validated by the shipped schema #then it validates", () => {
    // given
    const validate = createCommittedSchemaValidator()
    const example = extractSchemaExample(readFileSync(DOC_PATH, "utf-8"))

    // when
    const valid = validate(example)

    // then
    if (!valid) throw new Error(JSON.stringify(validate.errors))
    expect(valid).toBe(true)
  })

  test("#given an unknown task key #when validated by the shipped schema #then strictness is retained", () => {
    // given
    const validate = createCommittedSchemaValidator()
    const config = {
      task: {
        default_execution_mode: "in-process",
        default_concurrency: 5,
        max_depth: 1,
        residency_max_children: 8,
        ttl_ms: 86400000,
        wait: { min_ms: 5000, default_ms: 60000, max_ms: 600000 },
        team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
        unexpected: true,
      },
    }

    // when
    const valid = validate(config)

    // then
    expect(valid).toBe(false)
    expect(validate.errors?.some((error) => error.keyword === "additionalProperties")).toBe(true)
  })

  test("#given the docs example #when read #then it points at the documented dev-branch schema URL", () => {
    // given
    const example = extractSchemaExample(readFileSync(DOC_PATH, "utf-8")) as { readonly $schema?: string }

    // when
    const schemaUrl = example.$schema

    // then
    expect(schemaUrl).toBe(
      "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
    )
  })
})
