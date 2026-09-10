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
        git_master: { include_co_authored_by: false },
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
            git_master: { commit_footer: false },
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
    expect(result.data["[codex]"]?.git_master?.include_co_authored_by).toBe(false)
    expect(result.data.profiles.focused?.["[codex]"]?.git_master?.commit_footer).toBe(false)
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

  test("#given base telemetry and an empty codex block #when parsed #then the block stays default-free", () => {
    // given
    const config = {
      telemetry: { enabled: false },
      "[codex]": { telemetry: {} },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.telemetry?.enabled).toBe(false)
    expect(Object.hasOwn(result.data["[codex]"]?.telemetry ?? {}, "enabled")).toBe(false)
  })
})
