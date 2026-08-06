import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { parseConfigSections } from "./config-section-parser"

const ConfigSchema = z.object({
  nested: z.object({
    label: z.string(),
  }).optional(),
  names: z.array(z.string()).optional(),
})

describe("parseConfigSections", () => {
  test("#given one invalid config section #when parsing section-wise #then valid sections are preserved", () => {
    // given
    const invalidSections: string[] = []
    const rawConfig = {
      nested: { label: "kept" },
      names: ["valid", 42],
    }

    // when
    const result = parseConfigSections(ConfigSchema, rawConfig, {
      onInvalidSections: (sections) => invalidSections.push(...sections),
    })

    // then
    expect(result).toEqual({ nested: { label: "kept" } })
    expect(invalidSections).toEqual(["names: names.1: Invalid input: expected string, received number"])
  })

  test("#given prototype pollution keys #when parsing section-wise #then unsafe keys are ignored", () => {
    // given
    const rawConfig = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"nested":{"label":"kept"}}') as Record<string, unknown>

    // when
    const result = parseConfigSections(ConfigSchema, rawConfig)

    // then
    expect(result).toEqual({ nested: { label: "kept" } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false)
  })
})
