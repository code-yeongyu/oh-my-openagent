/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  buildOpenferenceCatalog,
  serializeOpenferenceCatalog,
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
      id: "Kimi K2.6",
      context_length: 262144,
      max_output_tokens: 131072,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: true, attachment: true },
      pricing: { prompt: "0.00000095", completion: "0.000004", cache_read: "0.00000016" },
      reasoning: { supported: true, control: "toggle" },
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
      id: "Unpublished-Output-Limit",
      context_length: 524288,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0.00000003", completion: "0.00000015" },
    },
    {
      id: "Unpublished-Context",
      max_output_tokens: 65536,
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tool_calling: true, vision: false, attachment: false },
      pricing: { prompt: "0.00000003", completion: "0.00000015" },
    },
  ],
}

describe("buildOpenferenceCatalog", () => {
  test("maps a fully-published model entry verbatim from the listing", () => {
    // given the GLM-5.2 listing entry with pricing, limits, modalities and reasoning
    // when the catalog is built
    const catalog = buildOpenferenceCatalog(gatewayResponse)

    // then the entry carries the id as name plus capabilities, per-million costs and limits
    expect(catalog["GLM-5.2"]).toEqual({
      name: "GLM-5.2",
      reasoning: true,
      tool_call: true,
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 1.4, output: 4.4, cache_read: 0.26, cache_write: 0 },
      limit: { context: 262144, output: 128000 },
    })
  })

  test("prefers the published display name over the id", () => {
    // given DeepSeek-V4-Pro-0813 with display_name "DeepSeek V4 Pro"
    // when the catalog is built
    const catalog = buildOpenferenceCatalog(gatewayResponse)

    // then the display name becomes the entry's name while the id stays the key
    expect(catalog["DeepSeek-V4-Pro-0813"]?.name).toBe("DeepSeek V4 Pro")
  })

  test("derives attachment from the image input modality", () => {
    // given one multimodal-input model and one text-only model
    // when the catalog is built
    const catalog = buildOpenferenceCatalog(gatewayResponse)

    // then attachment tracks the image modality
    expect(catalog["GLM-5.3-Flash"]?.attachment).toBe(true)
    expect(catalog["GLM-5.3-Flash"]?.modalities.input).toEqual(["text", "image", "video"])
    expect(catalog["GLM-5.2"]?.attachment).toBe(false)
  })

  test("excludes models without text output, tool calling, or published limits", () => {
    // given an image-generation model, a model that cannot call tools, and
    // models missing one of the two published limits
    // when the catalog is built
    const catalog = buildOpenferenceCatalog(gatewayResponse)

    // then none of them appear
    expect(catalog["SDXL Lightning"]).toBeUndefined()
    expect(catalog["No-Tool-Chat"]).toBeUndefined()
    expect(catalog["Unpublished-Output-Limit"]).toBeUndefined()
    expect(catalog["Unpublished-Context"]).toBeUndefined()
  })

  test("treats an unsupported reasoning model as non-reasoning", () => {
    // given a listing entry without reasoning metadata
    const response: OpenferenceCatalogResponse = {
      data: [
        {
          id: "Plain-Chat",
          context_length: 131072,
          max_output_tokens: 65536,
          input_modalities: ["text"],
          output_modalities: ["text"],
          capabilities: { tool_calling: true, vision: false, attachment: false },
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    }

    // when the catalog is built
    const catalog = buildOpenferenceCatalog(response)

    // then the entry registers with reasoning false and zero cost
    expect(catalog["Plain-Chat"]?.reasoning).toBe(false)
    expect(catalog["Plain-Chat"]?.cost).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 })
  })

  test("defaults missing pricing fields to zero instead of borrowing rates", () => {
    // given a tool-capable entry whose listing omits cache_read pricing
    const response: OpenferenceCatalogResponse = {
      data: [
        {
          id: "No-Cache-Rate",
          context_length: 131072,
          max_output_tokens: 128000,
          input_modalities: ["text"],
          output_modalities: ["text"],
          capabilities: { tool_calling: true, vision: false, attachment: false },
          pricing: { prompt: "0.00000006", completion: "0.0000004" },
          reasoning: { supported: true },
        },
      ],
    }

    // when the catalog is built
    const catalog = buildOpenferenceCatalog(response)

    // then cache costs stay zero rather than inheriting the input rate
    expect(catalog["No-Cache-Rate"]?.cost).toEqual({
      input: 0.06,
      output: 0.4,
      cache_read: 0,
      cache_write: 0,
    })
  })
})

describe("serializeOpenferenceCatalog", () => {
  test("emits lexicographically sorted keys, 2-space indent and a trailing newline", () => {
    // given a catalog built from the fixtures
    const catalog = buildOpenferenceCatalog(gatewayResponse)

    // when it is serialized
    const json = serializeOpenferenceCatalog(catalog)

    // then keys are sorted, indentation is 2 spaces, and the file ends with a newline
    expect(Object.keys(JSON.parse(json) as Record<string, unknown>)).toEqual(
      ["GLM-5.2", "GLM-5.3-Flash", "DeepSeek-V4-Pro-0813", "Kimi K2.6"].sort(),
    )
    expect(json.endsWith("}\n")).toBe(true)
    expect(json.split("\n")[1]).toBe('  "DeepSeek-V4-Pro-0813": {')
  })
})
