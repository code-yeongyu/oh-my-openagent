/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  buildOpenferenceSenpiCatalog,
  serializeOpenferenceSenpiCatalog,
  type OpenferenceCatalogResponse,
} from "./generate-openference-models"

const gatewayResponse: OpenferenceCatalogResponse = {
  data: [
    {
      id: "GLM-5.2",
      context_length: 262144,
      max_output_tokens: 128000,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0.0000014", completion: "0.0000044", cache_read: "0.00000026" },
      reasoning: { supported: true, control: "effort", supported_efforts: ["high", "low"] },
    },
    {
      id: "GLM-5.3-Flash",
      context_length: 1048576,
      max_output_tokens: 128000,
      input_modalities: ["text", "image", "video"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: true, attachment: true },
      pricing: { prompt: "0.00000015", completion: "0.0000005", cache_read: "0.00000003" },
      reasoning: { supported: true, control: "effort", supported_efforts: ["max", "high", "low"] },
    },
    {
      id: "Kimi K2.7 Code",
      context_length: 262144,
      max_output_tokens: 131072,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: true, attachment: true },
      pricing: { prompt: "0.00000095", completion: "0.000004", cache_read: "0.00000019" },
      reasoning: { supported: true, control: "always_on" },
    },
    {
      id: "MiniMax M3",
      context_length: 1048576,
      max_output_tokens: 131072,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: true, attachment: true },
      pricing: { prompt: "0.0000003", completion: "0.0000012", cache_read: "0.00000006" },
      reasoning: { supported: true, control: "adaptive" },
    },
    {
      id: "DeepSeek-V4-Pro-0813",
      display_name: "DeepSeek V4 Pro",
      context_length: 1048576,
      max_output_tokens: 384000,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0.00000132", completion: "0.00000396", cache_read: "0.000000044" },
      reasoning: { supported: true, control: "effort", supported_efforts: ["max", "high"] },
    },
    {
      id: "SDXL Lightning",
      context_length: 4096,
      input_modalities: ["text"],
      output_modalities: ["image"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0", completion: "0.0000014" },
    },
    {
      id: "No-Tool-Chat",
      context_length: 131072,
      max_output_tokens: 65536,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: false },
      pricing: { prompt: "0", completion: "0" },
    },
    {
      id: "Unpublished-Limits",
      context_length: 524288,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0.00000003", completion: "0.00000015" },
    },
  ],
}

describe("buildOpenferenceSenpiCatalog", () => {
  test("maps a fully-published effort model onto the Pi entry shape", () => {
    // given the GLM-5.2 listing entry with pricing, limits, modalities and efforts
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then the entry carries Pi-shaped costs, limits and a thinking level map
    expect(catalog.find((entry) => entry.id === "GLM-5.2")).toEqual({
      id: "GLM-5.2",
      name: "GLM-5.2",
      reasoning: true,
      input: ["text"],
      contextWindow: 262144,
      maxTokens: 128000,
      cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null },
    })
  })

  test("maps image input to Pi's text+image pair and drops other input modalities", () => {
    // given GLM-5.3-Flash advertising text, image and video input
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then input is exactly ["text", "image"] (Pi supports no video input)
    expect(catalog.find((entry) => entry.id === "GLM-5.3-Flash")?.input).toEqual(["text", "image"])
  })

  test("emits only the off-null map for always-on reasoning models", () => {
    // given Kimi K2.7 Code with control always_on
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then thinking cannot be disabled and no effort levels are claimed
    expect(catalog.find((entry) => entry.id === "Kimi K2.7 Code")?.thinkingLevelMap).toEqual({ off: null })
  })

  test("omits thinkingLevelMap for adaptive and toggle reasoning controls", () => {
    // given MiniMax M3 with adaptive thinking
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then the field is absent so Pi's default mapping applies
    expect(catalog.find((entry) => entry.id === "MiniMax M3")?.thinkingLevelMap).toBeUndefined()
  })

  test("prefers the published display name and marks unsupported effort levels null", () => {
    // given DeepSeek-V4-Pro-0813 with display_name and efforts max/high only
    // when the catalog is built
    const entry = buildOpenferenceSenpiCatalog(gatewayResponse).find((item) => item.id === "DeepSeek-V4-Pro-0813")

    // then the display name becomes the entry name and unmapped levels are null
    expect(entry?.name).toBe("DeepSeek V4 Pro")
    expect(entry?.thinkingLevelMap).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    })
  })

  test("excludes models without text output, tool calling, or published limits", () => {
    // given an image-generation model, a model that cannot call tools, and a
    // model missing max_output_tokens
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then none of them appear
    expect(catalog.find((entry) => entry.id === "SDXL Lightning")).toBeUndefined()
    expect(catalog.find((entry) => entry.id === "No-Tool-Chat")).toBeUndefined()
    expect(catalog.find((entry) => entry.id === "Unpublished-Limits")).toBeUndefined()
  })

  test("sorts entries by id", () => {
    // given the fixture listing in non-alphabetical order
    // when the catalog is built
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // then entries come out sorted by id
    expect(catalog.map((entry) => entry.id)).toEqual(
      [...catalog.map((entry) => entry.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })
})

describe("serializeOpenferenceSenpiCatalog", () => {
  test("emits a JSON array with 2-space indent and a trailing newline", () => {
    // given a catalog built from the fixtures
    const catalog = buildOpenferenceSenpiCatalog(gatewayResponse)

    // when it is serialized
    const json = serializeOpenferenceSenpiCatalog(catalog)

    // then it parses back to the catalog and the file ends with a newline
    expect(JSON.parse(json) as unknown).toEqual(catalog)
    expect(json.endsWith("]\n")).toBe(true)
  })
})
