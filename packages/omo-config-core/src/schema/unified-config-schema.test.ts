import { describe, expect, test } from "bun:test"

import { OmoConfigSchema } from "../index"

describe("unified omo config schema", () => {
  test("#given a VSCode-style config with every unified key #when parsed #then all supported sections are preserved", () => {
    // given
    const config = {
      models: {
        sol: { model: "openai/gpt-5.6-sol", variant: "high", reasoningEffort: "xhigh" },
      },
      "[opencode]": {
        background_task: { enabled: true },
      },
      "[senpi]": {
        agents: {
          oracle: { model: "sol" },
        },
      },
      "[codex]": {
        codegraph: { daemon: false },
      },
      profiles: {
        focused: {
          categories: {
            deep: { model: "sol" },
          },
          models: {
            sol: { model: "openai/gpt-5.6-sol", reasoningEffort: "high" },
          },
          "[opencode]": {
            background_task: { enabled: false },
          },
          "[senpi]": {
            task: { default_concurrency: 2 },
          },
          "[codex]": {
            codegraph: { enabled: false },
          },
        },
      },
      _migrations: ["2026-07-opencode-config-unification"],
      legacy_migrations: {
        "legacy-config": { migrated: true },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.models?.sol).toEqual({
      model: "openai/gpt-5.6-sol",
      reasoning: "xhigh",
    })
    expect(result.data["[opencode]"]).toEqual({ background_task: { enabled: true } })
    expect(result.data["[senpi]"]?.agents?.oracle?.model).toBe("sol")
    expect(result.data["[codex]"]?.codegraph?.daemon).toBe(false)
    expect(result.data.profiles.focused?.["[codex]"]?.codegraph?.enabled).toBe(false)
    expect(result.data._migrations).toEqual(["2026-07-opencode-config-unification"])
    expect(result.data.legacy_migrations?.["legacy-config"]).toEqual({ migrated: true })
  })

  test("#given partial model catalog entries in harness and profile overlays #when parsed #then they remain default-free deep-partials", () => {
    // given
    const config = {
      models: {
        sol: { model: "openai/gpt-5.6-sol" },
      },
      "[senpi]": {
        models: {
          sol: { reasoningEffort: "high" },
        },
      },
      profiles: {
        focused: {
          models: {
            sol: { variant: "low" },
          },
          "[codex]": {
            models: {
              sol: { reasoningEffort: "minimal" },
            },
          },
        },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data["[senpi]"]?.models?.sol).toEqual({ reasoning: "high" })
    expect(result.data.profiles.focused?.models?.sol).toEqual({ reasoning: "low" })
    expect(result.data.profiles.focused?.["[codex]"]?.models?.sol).toEqual({ reasoning: "minimal" })
  })

  test("#given unknown root and profile overlay keys #when parsed #then the strict schema rejects both", () => {
    // given
    const unknownRoot = { unknown_key: 1 }
    const unknownProfileKey = {
      profiles: {
        focused: { unknown_key: 1 },
      },
    }

    // when
    const rootResult = OmoConfigSchema.safeParse(unknownRoot)
    const profileResult = OmoConfigSchema.safeParse(unknownProfileKey)

    // then
    expect(rootResult.success).toBe(false)
    expect(profileResult.success).toBe(false)
  })

  test("#given an array opencode block #when parsed #then rejection identifies the block path", () => {
    // given
    const config = { "[opencode]": [] }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected the opaque opencode block to reject arrays")
    expect(result.error.issues.map((issue) => issue.path.join(".")).some((path) => path.includes("[opencode]"))).toBe(true)
  })

  test("#given the complete legacy codegraph setting set #when parsed #then values parse and legacy defaults are preserved", () => {
    // given
    const config = {
      codegraph: {
        enabled: false,
        auto_provision: false,
        daemon: false,
        telemetry: true,
        install_dir: "/tmp/omo-codegraph",
        watch_debounce_ms: 250,
        excluded_roots: ["/tmp/generated", "/tmp/vendor"],
      },
    }

    // when
    const explicitResult = OmoConfigSchema.safeParse(config)
    const defaultResult = OmoConfigSchema.safeParse({ codegraph: {} })

    // then
    expect(explicitResult.success).toBe(true)
    if (!explicitResult.success) throw new Error(explicitResult.error.message)
    expect(explicitResult.data.codegraph).toEqual(config.codegraph)
    expect(defaultResult.success).toBe(true)
    if (!defaultResult.success) throw new Error(defaultResult.error.message)
    expect(defaultResult.data.codegraph).toEqual({
      enabled: true,
      auto_provision: true,
      daemon: true,
      telemetry: false,
    })
  })

  test("#given base telemetry and an empty codex block #when parsed #then the block stays default-free", () => {
    // given
    const config = {
      codegraph: { telemetry: true },
      "[codex]": { codegraph: {} },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.codegraph?.telemetry).toBe(true)
    expect(Object.hasOwn(result.data["[codex]"]?.codegraph ?? {}, "telemetry")).toBe(false)
  })
})
