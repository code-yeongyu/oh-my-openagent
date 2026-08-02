import { describe, expect, test } from "bun:test"
import { omitDefaultBackedRequiredProperties } from "./build-omo-schema-document"

describe("omitDefaultBackedRequiredProperties", () => {
  test("#given schema-shaped annotation payloads #when required defaults are omitted #then annotations stay unchanged", () => {
    // given
    const annotationPayload = {
      properties: { omitted: { default: true } },
      required: ["omitted"],
    }
    const schema = {
      properties: {
        omitted: { default: true },
        preserved: {
          default: structuredClone(annotationPayload),
          const: structuredClone(annotationPayload),
          examples: [structuredClone(annotationPayload)],
        },
      },
      required: ["omitted"],
    }

    // when
    omitDefaultBackedRequiredProperties(schema)

    // then
    expect(schema.properties.preserved.default.required).toEqual(["omitted"])
    expect(schema.properties.preserved.const.required).toEqual(["omitted"])
    expect(schema.properties.preserved.examples[0]?.required).toEqual(["omitted"])
  })
})
