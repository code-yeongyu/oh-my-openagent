import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { optionalizeDefaultedProperties } from "./json-schema-defaulted-optional"

describe("optionalizeDefaultedProperties (#6445)", () => {
  test("#given a Zod output-mode schema with defaulted fields #when optionalized #then only the defaulted names leave required", () => {
    // given
    const schema = z.toJSONSchema(z.object({
      name: z.string(),
      git_master: z.object({ commit_footer: z.boolean().default(false), prefix: z.string() }).default({ commit_footer: false, prefix: "GIT" }),
      profiles: z.record(z.string(), z.object({ enabled: z.boolean().default(true) })).default({}),
    }).strict(), { target: "draft-7" }) as Record<string, unknown>
    expect(schema.required).toEqual(["name", "git_master", "profiles"])

    // when
    optionalizeDefaultedProperties(schema)

    // then
    const properties = schema.properties as Record<string, Record<string, unknown>>
    expect(schema.required).toEqual(["name"])
    expect(properties.git_master?.required).toEqual(["prefix"])
    const profile = properties.profiles?.additionalProperties as Record<string, unknown>
    expect(profile.required).toBeUndefined()
    expect(schema.additionalProperties).toBe(false)
    expect(properties.git_master?.additionalProperties).toBe(false)
  })

  test("#given defaulted fields nested under anyOf and array items #when optionalized #then those levels are relaxed too", () => {
    // given
    const schema = z.toJSONSchema(z.object({
      entries: z.array(z.union([z.string(), z.object({ model: z.string(), weight: z.number().default(1) })])),
    }), { target: "draft-7" }) as Record<string, unknown>

    // when
    optionalizeDefaultedProperties(schema)

    // then
    const entries = (schema.properties as Record<string, Record<string, unknown>>).entries
    const variants = (entries?.items as Record<string, unknown>).anyOf as Record<string, unknown>[]
    expect(variants[1]?.required).toEqual(["model"])
  })
})
