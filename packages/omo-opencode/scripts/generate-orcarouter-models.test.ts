/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  buildOrcaRouterCatalog,
  serializeOrcaRouterCatalog,
  type ModelsDevCatalogs,
  type OrcaRouterCatalogResponse,
} from "./generate-orcarouter-models"

const gatewayResponse: OrcaRouterCatalogResponse = {
  data: [
    { id: "orcarouter/auto", context_length: 128000 },
    { id: "orcarouter/free" },
    { id: "orcarouter/fusion", context_length: 1000000 },
    { id: "orcarouter/fusion-flash", context_length: 200000 },
    { id: "orcarouter/fusion-mini", context_length: 1000000 },
    { id: "orcarouter/test-cache-glm52-opus" },
    { id: "orcarouter/simple-test" },
    { id: "orcarouter/intco-qa" },
    { id: "openai/gpt-5.4" },
    { id: "anthropic/claude-fable-5" },
  ],
}

const modelsDev: ModelsDevCatalogs = {
  orcarouter: {
    models: {
      "orcarouter/auto": {
        name: "OrcaRouter Auto",
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      },
    },
  },
}

describe("buildOrcaRouterCatalog", () => {
  test("keeps only the gateway's own routing products", () => {
    // given a response mixing orcarouter/* ids with third-party and test ids
    // when the catalog is built
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // then only product-level orcarouter/* ids survive
    const ids = Object.keys(catalog)
    expect(ids).toEqual([
      "orcarouter/auto",
      "orcarouter/free",
      "orcarouter/fusion",
      "orcarouter/fusion-flash",
      "orcarouter/fusion-mini",
    ])
    expect(ids.some((id) => id.startsWith("openai/") || id.startsWith("anthropic/"))).toBe(false)
  })

  test("excludes test and internal ids", () => {
    // given the endpoint listing test/internal ids
    // when the catalog is built
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // then they are absent
    expect(catalog["orcarouter/test-cache-glm52-opus"]).toBeUndefined()
    expect(catalog["orcarouter/simple-test"]).toBeUndefined()
    expect(catalog["orcarouter/intco-qa"]).toBeUndefined()
  })

  test("enriches orcarouter/auto from the models.dev provider catalog", () => {
    // given the models.dev orcarouter catalog carrying auto-router metadata
    // when the catalog is built
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // then the entry carries that provider's name, capabilities, cost and limits
    expect(catalog["orcarouter/auto"]).toEqual({
      name: "OrcaRouter Auto",
      reasoning: false,
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context: 128000, output: 16384 },
    })
  })

  test("takes the context-window from the endpoint for models models.dev lacks", () => {
    // given product models absent from models.dev but served by the endpoint
    // when the catalog is built
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // then the endpoint's reported context-window is used
    expect(catalog["orcarouter/fusion"]?.limit.context).toBe(1000000)
    expect(catalog["orcarouter/fusion-flash"]?.limit.context).toBe(200000)
  })

  test("assumes tool capability for endpoint-only routing products", () => {
    // given a routing product with no models.dev entry
    // when the catalog is built
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // then tool calling is assumed for the gateway product
    expect(catalog["orcarouter/fusion"]?.tool_call).toBe(true)
  })

  test("serializes sorted and lexicographic", () => {
    // given a built catalog
    const catalog = buildOrcaRouterCatalog(gatewayResponse, modelsDev)

    // when it is serialized and reparsed
    const parsed = JSON.parse(serializeOrcaRouterCatalog(catalog)) as Record<string, unknown>

    // then the keys are sorted ascending
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort())
  })
})
