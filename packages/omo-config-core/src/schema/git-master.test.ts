import { describe, expect, test } from "bun:test"

import {
  GIT_MASTER_HARNESS_SUPPORT,
  OmoConfigLayerSchema,
  OmoConfigSchema,
  OmoGitMasterSettingsSchema,
} from "../index"

describe("omo config git_master section", () => {
  test("#given an empty git_master section #when parsed #then attribution defaults are off", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.include_co_authored_by).toBe(false)
    expect(result.data.git_master?.commit_footer).toBe(false)
  })

  test("#given explicit overrides #when parsed #then a custom footer string and a disabled co-author are preserved", () => {
    // given
    const config = {
      git_master: {
        commit_footer: "Shipped with omo",
        include_co_authored_by: false,
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.commit_footer).toBe("Shipped with omo")
    expect(result.data.git_master?.include_co_authored_by).toBe(false)
  })

  test("#given a [senpi] harness override #when parsed #then the git_master layer is accepted", () => {
    // given
    const config = {
      "[senpi]": {
        git_master: { include_co_authored_by: false },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a profile override #when parsed #then the git_master layer is accepted", () => {
    // given
    const config = {
      profiles: {
        work: {
          git_master: { commit_footer: false },
        },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a git_master layer without values #when parsed as a layer #then no defaults are injected", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.include_co_authored_by).toBeUndefined()
    expect(result.data.git_master?.commit_footer).toBeUndefined()
  })

  test("#given an unknown key inside git_master #when parsed #then the config is rejected", () => {
    // given
    const config = { git_master: { co_author: "someone" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given an empty git_master section #when parsed #then git_env_prefix defaults to GIT_MASTER=1", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.git_env_prefix).toBe("GIT_MASTER=1")
  })

  test("#given git_env_prefix set to an empty string #when parsed #then the empty string is preserved as the disabled state", () => {
    // given
    const config = { git_master: { git_env_prefix: "" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.git_env_prefix).toBe("")
  })

  test("#given git_env_prefix with a shell-unsafe value #when parsed #then the config is rejected", () => {
    // given
    const config = { git_master: { git_env_prefix: "GIT_MASTER=1; rm -rf /" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given git_env_prefix with multiple assignments #when parsed #then the value is accepted", () => {
    // given
    const config = { git_master: { git_env_prefix: "GIT_MASTER=1 OMO_AGENT=x" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.git_env_prefix).toBe("GIT_MASTER=1 OMO_AGENT=x")
  })

  test("#given a git_master layer without git_env_prefix #when parsed as a layer #then no default is injected", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.git_env_prefix).toBeUndefined()
  })

  test("#given the resolved settings schema #when defaults are applied #then git_env_prefix and the harness support map agree", () => {
    // given
    const settings = OmoGitMasterSettingsSchema.parse({})

    // when / then
    expect(settings.git_env_prefix).toBe("GIT_MASTER=1")
    expect(GIT_MASTER_HARNESS_SUPPORT["git_master.git_env_prefix"]).toContain("native")
  })
})
