/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { tool } from "@opencode-ai/plugin"
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas"

const tempDirectories: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

async function loadSeparateHostZodModule(): Promise<typeof import("zod")> {
  const pluginPackageDirectory = dirname(Bun.resolveSync("@opencode-ai/plugin/package.json", import.meta.dir))
  const sourceZodDirectory = join(pluginPackageDirectory, "node_modules", "zod")
  const tempDirectory = mkdtempSync(join(tmpdir(), "omo-host-zod-"))
  const copiedZodDirectory = join(tempDirectory, "zod")

  cpSync(sourceZodDirectory, copiedZodDirectory, { recursive: true })
  tempDirectories.push(tempDirectory)

  return await import(pathToFileURL(join(copiedZodDirectory, "index.js")).href)
}

function serializeWithHostZod(
  hostZod: typeof import("zod"),
  args: Record<string, object>,
): Record<string, unknown> {
  return hostZod.z.toJSONSchema(Reflect.apply(hostZod.z.object, hostZod.z, [args]))
}

describe("normalizeToolArgSchemas", () => {
  afterEach(() => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it("preserves nested descriptions and metadata across zod instances", async () => {
    // given
    const hostZod = await loadSeparateHostZodModule()
    const toolDefinition = tool({
      description: "Search tool",
      args: {
        filters: tool.schema
          .object({
            query: tool.schema
              .string()
              .describe("Free-text search query")
              .meta({ title: "Query", examples: ["issue 2314"] }),
          })
          .describe("Filter options")
          .meta({ title: "Filters" }),
      },
      async execute(): Promise<string> {
        return "ok"
      },
    })

    // when
    const beforeSchema = serializeWithHostZod(hostZod, toolDefinition.args)
    const beforeProperties = getNestedRecord(beforeSchema, "properties")
    const beforeFilters = beforeProperties ? getNestedRecord(beforeProperties, "filters") : undefined
    const beforeFilterProperties = beforeFilters ? getNestedRecord(beforeFilters, "properties") : undefined
    const beforeQuery = beforeFilterProperties ? getNestedRecord(beforeFilterProperties, "query") : undefined

    normalizeToolArgSchemas(toolDefinition)

    const afterSchema = serializeWithHostZod(hostZod, toolDefinition.args)
    const afterProperties = getNestedRecord(afterSchema, "properties")
    const afterFilters = afterProperties ? getNestedRecord(afterProperties, "filters") : undefined
    const afterFilterProperties = afterFilters ? getNestedRecord(afterFilters, "properties") : undefined
    const afterQuery = afterFilterProperties ? getNestedRecord(afterFilterProperties, "query") : undefined

    // then
    expect(beforeFilters?.description).toBeUndefined()
    expect(beforeFilters?.title).toBeUndefined()
    expect(beforeQuery?.description).toBeUndefined()
    expect(beforeQuery?.title).toBeUndefined()
    expect(beforeQuery?.examples).toBeUndefined()

    expect(afterFilters?.description).toBe("Filter options")
    expect(afterFilters?.title).toBe("Filters")
    expect(afterQuery?.description).toBe("Free-text search query")
    expect(afterQuery?.title).toBe("Query")
    expect(afterQuery?.examples).toEqual(["issue 2314"])
  })
})
