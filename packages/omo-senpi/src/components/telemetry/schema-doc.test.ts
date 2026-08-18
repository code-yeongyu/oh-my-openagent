import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const BEGIN_SENTINEL = "<!-- BEGIN GENERATED SCHEMA -->"
const END_SENTINEL = "<!-- END GENERATED SCHEMA -->"
const WORKSPACE_ROOT = resolve(import.meta.dir, "../../../../..")
const DOC_PATH = resolve(WORKSPACE_ROOT, "docs/reference/senpi-telemetry.md")
const GENERATOR_URL = new URL("../../../../../script/telemetry-schema-block.mjs", import.meta.url)

type SchemaBlockGenerator = (schemas?: unknown) => string

async function loadGenerator(): Promise<SchemaBlockGenerator> {
  const loaded: unknown = await import(GENERATOR_URL.href)
  if (loaded === null || typeof loaded !== "object") {
    throw new Error("Telemetry schema generator module did not load")
  }

  const generator = Reflect.get(loaded, "generateTelemetrySchemaBlock")
  if (typeof generator !== "function") {
    throw new Error("Telemetry schema generator does not export generateTelemetrySchemaBlock")
  }
  return generator as SchemaBlockGenerator
}

function extractGeneratedBlock(document: string): string | undefined {
  const beginIndex = document.indexOf(BEGIN_SENTINEL)
  if (beginIndex < 0) return undefined

  const endIndex = document.indexOf(END_SENTINEL, beginIndex + BEGIN_SENTINEL.length)
  if (endIndex < 0) return undefined
  if (document.indexOf(BEGIN_SENTINEL, beginIndex + BEGIN_SENTINEL.length) >= 0) return undefined
  if (document.indexOf(END_SENTINEL, endIndex + END_SENTINEL.length) >= 0) return undefined

  return document.slice(beginIndex, endIndex + END_SENTINEL.length)
}

describe("OmO Native telemetry schema documentation", () => {
  test("#given the product allowlists #when the reference is checked #then the generated schema block is byte exact", async () => {
    const generateTelemetrySchemaBlock = await loadGenerator()
    const expected = generateTelemetrySchemaBlock()
    const actual = extractGeneratedBlock(await readFile(DOC_PATH, "utf8"))

    if (actual !== expected) {
      throw new Error([
        "Telemetry schema documentation drifted.",
        "Paste this exact generated block into docs/reference/senpi-telemetry.md:",
        expected,
      ].join("\n\n"))
    }
  })

  test("#given an empty property schema #when generation is attempted #then no corrupt block is emitted", async () => {
    const generateTelemetrySchemaBlock = await loadGenerator()

    expect(() => generateTelemetrySchemaBlock({ empty_event: {} })).toThrow(
      "Telemetry event empty_event must contain at least one property schema",
    )
  })
})
