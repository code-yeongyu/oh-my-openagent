/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mergeConfigs } from "../../plugin-config"
import {
  IDMConfigSchema,
  type IDMConfig,
} from "./idm-config"

const DEFAULT_MEMORY_AGENT = {
  enabled: true,
  provider: "runtime",
  promote_to_l2: true,
  promote_to_l3: true,
  ingestion_enabled: true,
  max_inline_payload_chars: 8000,
  remote_docling_host: "localhost",
  remote_docling_python_env: "$HOME/l3-env/bin/activate",
  database_url: null,
  mem0: {
    api_key: null,
    base_url: null,
    organization_id: null,
    project_id: null,
  },
  l3: {
    vespa_base_url: "http://localhost:8080",
    pageindex_base_url: "http://localhost:8765",
    gemini_api_key: null,
    cohere_bedrock_region: null,
  },
  obsidian: {
    enabled: false,
    vault_path: null,
    omo_subdir: "omo",
  },
  curator: {
    enabled: false,
    interval_ms: 30 * 60_000,
    batch_size: 20,
    lookback_hours: 6,
    min_age_minutes: 5,
    project_id: null,
    transport: "vertex-direct",
    vertex_project_id: null,
    vertex_location: "global",
    adapter_base_url: "http://127.0.0.1:37999/v1/chat/completions",
    model: "google/gemini-3.1-pro-preview",
  },
  cartographer: {
    enabled: false,
    draft_interval_hours: 2,
    signal_threshold: "high",
    minimum_observations_for_cluster: 3,
    max_drafts_per_tick: 3,
    lookback_hours: 6,
    min_age_minutes: 5,
    project_id: null,
    transport: "vertex-direct",
    vertex_project_id: null,
    vertex_location: "global",
    model: "google/gemini-3.1-pro-preview",
  },
  meeting: {
    enabled: false,
    min_hours_between: 4,
    max_hours_between: 24,
    min_inbox_drafts: 3,
    idle_threshold_minutes: 5,
  },
} as const

describe("IDMConfigSchema memory_agent", () => {
  test("populates root-level memory_agent defaults", () => {
    const result = IDMConfigSchema.safeParse({})

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent).toEqual(DEFAULT_MEMORY_AGENT)
  })

  test("validates queue and promotion knobs at the root config level", () => {
    const invalidPromotionResult = IDMConfigSchema.safeParse({
      memory_agent: {
        promote_to_l2: "yes",
      },
    })
    const invalidQueueResult = IDMConfigSchema.safeParse({
      memory_agent: {
        max_inline_payload_chars: 0,
      },
    })

    expect(invalidPromotionResult.success).toBe(false)
    expect(invalidQueueResult.success).toBe(false)
  })

  test("normalizes legacy provider values to runtime", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        provider: "filesystem",
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.provider).toBe("runtime")
  })

  test("strips legacy interactive config keys from parsed output", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        namespace_default: "legacy",
        request_directory: ".sisyphus/memory",
        max_entries_per_recall: 50,
        max_iterations_per_turn: 5,
        allow_forget: true,
        allowed_operations: ["save", "forget"],
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent).toEqual(DEFAULT_MEMORY_AGENT)
  })

  test("strips legacy interactive provider_options from parsed output", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        provider_options: {
          request_directory: ".sisyphus/memory",
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent).toEqual(DEFAULT_MEMORY_AGENT)
  })

  test("accepts explicit remote Docling runtime settings", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        remote_docling_host: "dst",
        remote_docling_python_env: "/opt/docling/bin/activate",
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent).toMatchObject({
      remote_docling_host: "dst",
      remote_docling_python_env: "/opt/docling/bin/activate",
    })
  })

  test("accepts explicit mem0 connection settings", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        mem0: {
          api_key: "m0-testing",
          base_url: "https://mem0.example.com",
          organization_id: "org-1",
          project_id: "proj-1",
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.mem0).toEqual({
      api_key: "m0-testing",
      base_url: "https://mem0.example.com",
      organization_id: "org-1",
      project_id: "proj-1",
    })
  })

  test("accepts explicit l3 endpoint overrides", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        l3: {
          vespa_base_url: "http://arch:8080",
          pageindex_base_url: "http://arch:8765",
          gemini_api_key: "g-testing",
          cohere_bedrock_region: "us-east-1",
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.l3).toEqual({
      vespa_base_url: "http://arch:8080",
      pageindex_base_url: "http://arch:8765",
      gemini_api_key: "g-testing",
      cohere_bedrock_region: "us-east-1",
    })
  })

  test("accepts obsidian projection settings", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        obsidian: {
          enabled: true,
          vault_path: "/Users/someone/Documents/IDM",
          omo_subdir: "omo",
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.obsidian).toEqual({
      enabled: true,
      vault_path: "/Users/someone/Documents/IDM",
      omo_subdir: "omo",
    })
  })

  test("accepts cartographer loop settings", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        cartographer: {
          enabled: true,
          signal_threshold: "medium",
          max_drafts_per_tick: 5,
          vertex_project_id: "project-xyz",
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.cartographer).toMatchObject({
      enabled: true,
      signal_threshold: "medium",
      max_drafts_per_tick: 5,
      vertex_project_id: "project-xyz",
    })
  })

  test("accepts meeting scheduler settings", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        meeting: {
          enabled: true,
          min_hours_between: 2,
          max_hours_between: 12,
          min_inbox_drafts: 5,
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.meeting).toMatchObject({
      enabled: true,
      min_hours_between: 2,
      max_hours_between: 12,
      min_inbox_drafts: 5,
      idle_threshold_minutes: 5,
    })
  })

  test("accepts database_url override", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        database_url: "postgres://localhost:5432/omo",
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.memory_agent?.database_url).toBe(
      "postgres://localhost:5432/omo",
    )
  })

  test("rejects empty strings on secret fields", () => {
    const result = IDMConfigSchema.safeParse({
      memory_agent: {
        mem0: {
          api_key: "",
        },
      },
    })

    expect(result.success).toBe(false)
  })
})

describe("mergeConfigs memory_agent", () => {
  test("preserves existing memory_agent values when override is partial", () => {
    const baseConfig = {
      memory_agent: {
        enabled: false,
        promote_to_l2: false,
      },
    } as IDMConfig
    const overrideConfig = {
      memory_agent: {
        ingestion_enabled: false,
      },
    } as IDMConfig

    const mergedConfig = mergeConfigs(baseConfig, overrideConfig)

    expect(mergedConfig.memory_agent).toMatchObject({
      enabled: false,
      promote_to_l2: false,
      ingestion_enabled: false,
      promote_to_l3: true,
      max_inline_payload_chars: 8000,
      remote_docling_host: "localhost",
      remote_docling_python_env: "$HOME/l3-env/bin/activate",
    })
  })

  test("deep merges nested memory_agent subsections", () => {
    const baseConfig = {
      memory_agent: {
        obsidian: {
          enabled: true,
          vault_path: "/base/vault",
        },
      },
    } as IDMConfig
    const overrideConfig = {
      memory_agent: {
        obsidian: {
          vault_path: "/override/vault",
        },
      },
    } as IDMConfig

    const mergedConfig = mergeConfigs(baseConfig, overrideConfig)

    expect(mergedConfig.memory_agent?.obsidian).toMatchObject({
      enabled: true,
      vault_path: "/override/vault",
      omo_subdir: "omo",
    })
  })
})
