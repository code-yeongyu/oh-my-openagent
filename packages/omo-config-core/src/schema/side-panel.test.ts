import { describe, expect, test } from "bun:test"

import { OmoConfigLayerSchema, OmoConfigSchema, resolveOmoSidePanelSettings } from "../index"

describe("omo config side_panel section", () => {
  test("#given an empty side_panel section #when parsed #then the panel is off with every section enabled", () => {
    // given
    const config = { side_panel: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBe(false)
    expect(result.data.side_panel?.width).toBe("26%")
    expect(result.data.side_panel?.min_columns).toBe(120)
    expect(result.data.side_panel?.usage_poll_seconds).toBe(150)
    expect(result.data.side_panel?.sections).toEqual({
      session: true,
      context: true,
      usage: true,
      agents: true,
      tools: true,
      files: true,
      memory: true,
    })
  })

  test("#given explicit overrides #when parsed #then a column width and a disabled section are preserved", () => {
    // given
    const config = {
      side_panel: {
        enabled: true,
        width: 52,
        min_columns: 160,
        sections: { usage: false },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBe(true)
    expect(result.data.side_panel?.width).toBe(52)
    expect(result.data.side_panel?.min_columns).toBe(160)
    expect(result.data.side_panel?.sections.usage).toBe(false)
  })

  test("#given a [senpi] harness override #when parsed #then the side_panel layer is accepted", () => {
    // given
    const config = { "[senpi]": { side_panel: { enabled: true } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a profile override #when parsed #then the side_panel layer is accepted", () => {
    // given
    const config = { profiles: { work: { side_panel: { width: "30%" } } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a side_panel layer without values #when parsed as a layer #then no defaults are injected", () => {
    // given
    const config = { side_panel: {} }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBeUndefined()
    expect(result.data.side_panel?.width).toBeUndefined()
    expect(result.data.side_panel?.sections).toBeUndefined()
  })

  test("#given an unknown key inside side_panel #when parsed #then the config is rejected", () => {
    // given
    const config = { side_panel: { enabled: true, colour: "purple" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a width outside the sidebar range #when parsed #then the config is rejected", () => {
    // given
    const tooNarrow = { side_panel: { width: "5%" } }
    const tooWide = { side_panel: { width: "80%" } }
    const tooFewColumns = { side_panel: { width: 8 } }

    // when
    const results = [tooNarrow, tooWide, tooFewColumns].map((config) => OmoConfigSchema.safeParse(config))

    // then
    expect(results.map((result) => result.success)).toEqual([false, false, false])
  })

  test("#given a usage poll interval below the floor #when parsed #then the config is rejected", () => {
    // given
    const config = { side_panel: { usage_poll_seconds: 30 } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a config without a side_panel section #when resolved #then defaults are returned", () => {
    // given
    const config = OmoConfigSchema.parse({})

    // when
    const settings = resolveOmoSidePanelSettings(config)

    // then
    expect(settings.enabled).toBe(false)
    expect(settings.sections.files).toBe(true)
  })
})
