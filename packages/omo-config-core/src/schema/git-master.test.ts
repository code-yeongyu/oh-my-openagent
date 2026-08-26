import { describe, expect, test } from "bun:test"

import { OmoConfigLayerSchema, OmoConfigSchema } from "../index"

describe("omo config git_master section", () => {
  test("#given an empty git_master section #when parsed #then attribution defaults are enabled", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.git_master?.include_co_authored_by).toBe(true)
    expect(result.data.git_master?.commit_footer).toBe(true)
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
})
