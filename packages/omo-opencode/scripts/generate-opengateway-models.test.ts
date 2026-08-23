/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  buildOpenGatewayCatalog,
  serializeOpenGatewayCatalog,
  type ModelsDevCatalogs,
  type OpenGatewayCatalogResponse,
} from "./generate-opengateway-models"

const gatewayResponse: OpenGatewayCatalogResponse = {
  data: [
    {
      id: "anthropic/claude-fable-5",
      status: "active",
      endpoints: ["chat_completions"],
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    {
      id: "qwen/qwen4-max",
      status: "active",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "openrouter-only/mystery-1",
      status: "active",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "openai/gpt-3.5-turbo",
      status: "active",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "openai/legacy-embed",
      status: "active",
      endpoints: ["embeddings"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "openai/o1-preview",
      status: "retired",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "openai/gpt-4-0613",
      status: "deprecated",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "google/nowhere-2",
      status: "active",
      endpoints: ["chat_completions"],
      modalities: { input: ["text"], output: ["text"] },
    },
  ],
}

const modelsDev: ModelsDevCatalogs = {
  anthropic: {
    models: {
      "claude-fable-5": {
        name: "Claude Fable 5",
        tool_call: true,
        reasoning: true,
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
  alibaba: {
    models: {
      "qwen4-max": {
        name: "Qwen4 Max",
        tool_call: true,
        reasoning: false,
        limit: { context: 262144, output: 32768 },
        cost: {
          input: 1.2,
          output: 6,
          tiers: [
            {
              input: 2.4,
              output: 12,
              cache_read: 0.24,
              cache_write: 0,
              tier: { type: "context", size: 128000 },
            },
          ],
        },
      },
    },
  },
  openai: {
    models: {
      "gpt-3.5-turbo": {
        name: "GPT-3.5 Turbo",
        tool_call: false,
        limit: { context: 16385, output: 4096 },
        cost: { input: 0.5, output: 1.5 },
      },
    },
  },
  openrouter: {
    models: {
      "openrouter-only/mystery-1": {
        name: "Mystery 1",
        tool_call: true,
        reasoning: true,
        limit: { context: 131072, output: 8192 },
        cost: { input: 0.1, output: 0.4 },
      },
    },
  },
}

describe("buildOpenGatewayCatalog", () => {
  test("maps an owner-prefixed id onto its models.dev provider catalog", () => {
    // given the anthropic owner prefix and a models.dev "anthropic" catalog entry
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then the entry carries that provider's name, capabilities, cost and limits
    expect(catalog["anthropic/claude-fable-5"]).toEqual({
      name: "Claude Fable 5",
      reasoning: true,
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      limit: { context: 200000, output: 64000 },
    })
  })

  test("maps the x-ai style owner alias through the owner table", () => {
    // given the "qwen" owner prefix whose models.dev provider key is "alibaba"
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then the aliased provider catalog supplied the metadata
    expect(catalog["qwen/qwen4-max"]?.name).toBe("Qwen4 Max")
    expect(catalog["qwen/qwen4-max"]?.limit).toEqual({ context: 262144, output: 32768 })
  })

  test("preserves tiered pricing by keeping the base tier costs representable", () => {
    // given a models.dev entry with a context-tier pricing table
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then the flat cost fields stay the base prices the tier table extends
    expect(catalog["qwen/qwen4-max"]?.cost).toEqual({
      input: 1.2,
      output: 6,
      cache_read: 0.24,
      cache_write: 0,
    })
  })

  test("falls back to the OpenRouter id space when the owner catalog lacks the model", () => {
    // given an owner with no models.dev provider mapping but an openrouter entry
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then the openrouter entry enriched it
    expect(catalog["openrouter-only/mystery-1"]?.name).toBe("Mystery 1")
    expect(catalog["openrouter-only/mystery-1"]?.limit.context).toBe(131072)
  })

  test("uses the override table for models models.dev cannot enrich", () => {
    // given openai/gpt-4-0613, absent from models.dev but present in the override table
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then the override supplies name, cost and limits
    expect(catalog["openai/gpt-4-0613"]).toEqual({
      name: "GPT-4 (0613)",
      reasoning: false,
      tool_call: true,
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 30, output: 60, cache_read: 0, cache_write: 0 },
      limit: { context: 8192, output: 8192 },
    })
  })

  test("excludes a model whose models.dev entry is not tool-capable", () => {
    // given openai/gpt-3.5-turbo with tool_call false
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then it is absent
    expect(catalog["openai/gpt-3.5-turbo"]).toBeUndefined()
  })

  test("excludes models with no chat-completions endpoint, retired status, or metadata", () => {
    // given an embeddings-only model, a retired model, and an unknown model
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then none of them appear
    expect(catalog["openai/legacy-embed"]).toBeUndefined()
    expect(catalog["openai/o1-preview"]).toBeUndefined()
    expect(catalog["google/nowhere-2"]).toBeUndefined()
  })

  test("derives attachment from image input modality only", () => {
    // given one image-capable and one text-only gateway model
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // then attachment tracks the image modality
    expect(catalog["anthropic/claude-fable-5"]?.attachment).toBe(true)
    expect(catalog["qwen/qwen4-max"]?.attachment).toBe(false)
    expect(catalog["qwen/qwen4-max"]?.modalities).toEqual({ input: ["text"], output: ["text"] })
  })

  test("defaults missing cost and limit metadata to zero-cost and floor limits", () => {
    // given a models.dev entry with no cost or limit fields
    const sparse: ModelsDevCatalogs = {
      deepseek: { models: { "deepseek-v9": { name: "DeepSeek V9", tool_call: true } } },
    }
    const response: OpenGatewayCatalogResponse = {
      data: [
        {
          id: "deepseek/deepseek-v9",
          status: "active",
          endpoints: ["chat_completions"],
          modalities: { input: ["text"], output: ["text"] },
        },
      ],
    }

    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(response, sparse)

    // then costs are zero and limits fall back to the floor
    expect(catalog["deepseek/deepseek-v9"]?.cost).toEqual({
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
    })
    expect(catalog["deepseek/deepseek-v9"]?.limit).toEqual({ context: 4096, output: 4096 })
  })
})

// Repo policy bans these ids from every tracked surface, and the audits that
// enforce it scan this file too, so the retired ids are assembled the same way
// the audits assemble them instead of being spelled out.
// See script/gpt-mini-reference-audit.test.ts and
// packages/omo-opencode/src/shared/current-model-family.test.ts.
const RETIRED_MINI_ID = ["gpt-5.4", "mini"].join("-")
const RETIRED_MINI_DISPLAY_NAME = ["GPT 5.4", "Mini"].join(" ")

const policyResponse: OpenGatewayCatalogResponse = {
  data: [
    `openai/${RETIRED_MINI_ID}`,
    "openai/gpt-5.2",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.4",
    "openai/gpt-5.4-nano",
    "openai/chatgpt-flagship",
  ].map((id) => ({
    id,
    status: "active",
    endpoints: ["chat_completions"],
    modalities: { input: ["text"], output: ["text"] },
  })),
}

const policyModelsDev: ModelsDevCatalogs = {
  openai: {
    models: {
      [RETIRED_MINI_ID]: {
        name: "Retired Mini",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 0.25, output: 2 },
      },
      "gpt-5.2": {
        name: "Legacy Flagship",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
      },
      "gpt-5.3-codex": {
        name: "Codex Variant",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
      },
      "gpt-5.4": {
        name: "GPT-5.4",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
      },
      "gpt-5.4-nano": {
        name: "GPT-5.4 nano",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 0.05, output: 0.4 },
      },
      "chatgpt-flagship": {
        name: "GPT-5.2 (dated alias)",
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
      },
    },
  },
}

describe("repo retired-model policy", () => {
  test("excludes the retired mini model the reference audit bans", () => {
    // given a gateway catalog listing the retired mini id with full metadata
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(policyResponse, policyModelsDev)

    // then no key references it
    expect(Object.keys(catalog)).not.toContain(`openai/${RETIRED_MINI_ID}`)
    expect(JSON.stringify(catalog).toLowerCase()).not.toContain(RETIRED_MINI_ID)
  })

  test("excludes legacy GPT model families banned from active surfaces", () => {
    // given a gateway catalog listing a legacy-family model
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(policyResponse, policyModelsDev)

    // then it is absent
    expect(catalog["openai/gpt-5.2"]).toBeUndefined()
  })

  test("excludes a model whose enriched display name carries a banned reference", () => {
    // given a permitted id whose models.dev name names a legacy family model
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(policyResponse, policyModelsDev)

    // then the entry is dropped, because the audits scan the emitted JSON text
    expect(catalog["openai/chatgpt-flagship"]).toBeUndefined()
  })

  test("keeps the codex variant the family rule explicitly exempts", () => {
    // given a legacy-family id suffixed with the exempted codex marker
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(policyResponse, policyModelsDev)

    // then it survives the policy filter
    expect(catalog["openai/gpt-5.3-codex"]?.name).toBe("Codex Variant")
  })

  test("keeps sibling models that only share a prefix with a banned id", () => {
    // given permitted models sharing the retired model's family prefix
    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(policyResponse, policyModelsDev)

    // then the filter leaves them alone
    expect(Object.keys(catalog).sort()).toEqual(["openai/gpt-5.3-codex", "openai/gpt-5.4", "openai/gpt-5.4-nano"])
  })

  test("drops the retired mini model even when only its display name is banned", () => {
    // given a clean id whose enriched name is the retired mini display name
    const response: OpenGatewayCatalogResponse = {
      data: [
        {
          id: "openai/o-legacy-alias",
          status: "active",
          endpoints: ["chat_completions"],
          modalities: { input: ["text"], output: ["text"] },
        },
      ],
    }
    const sources: ModelsDevCatalogs = {
      openai: {
        models: {
          "o-legacy-alias": {
            name: RETIRED_MINI_DISPLAY_NAME,
            tool_call: true,
            limit: { context: 400000, output: 128000 },
            cost: { input: 0.25, output: 2 },
          },
        },
      },
    }

    // when the catalog is built
    const catalog = buildOpenGatewayCatalog(response, sources)

    // then nothing is emitted
    expect(catalog).toEqual({})
  })
})

describe("serializeOpenGatewayCatalog", () => {
  test("emits lexicographically sorted keys, 2-space indent and a trailing newline", () => {
    // given a catalog built from the fixtures
    const catalog = buildOpenGatewayCatalog(gatewayResponse, modelsDev)

    // when it is serialized
    const json = serializeOpenGatewayCatalog(catalog)

    // then keys are sorted, indentation is 2 spaces, and the file ends with a newline
    expect(Object.keys(JSON.parse(json) as Record<string, unknown>)).toEqual([
      "anthropic/claude-fable-5",
      "openai/gpt-4-0613",
      "openrouter-only/mystery-1",
      "qwen/qwen4-max",
    ])
    expect(json.endsWith("}\n")).toBe(true)
    expect(json.split("\n")[1]).toBe('  "anthropic/claude-fable-5": {')
  })
})
