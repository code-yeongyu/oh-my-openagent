import { describe, expect, test } from "bun:test"

import { adaptHostSkillConfig } from "./host-skill-config"

describe("adaptHostSkillConfig", () => {
  test("converts paths into SkillsConfig sources", () => {
    // given
    const hostConfig = {
      paths: ["/host/skills", "/other/skills"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then
    expect(result).toEqual({
      sources: ["/host/skills", "/other/skills"],
    })
  })

  test("drops skills.urls because the downstream loader does not materialize http(s) sources", () => {
    // given - host config with both paths and urls
    const hostConfig = {
      paths: ["/host/skills"],
      urls: ["https://example.com/skills/"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then - only paths survive; urls are intentionally not forwarded
    expect(result).toEqual({ sources: ["/host/skills"] })
  })

  test("returns undefined when urls is the only source (since urls are dropped)", () => {
    // when
    const result = adaptHostSkillConfig({ urls: ["https://example.com/skills/"] })

    // then
    expect(result).toBeUndefined()
  })

  test("filters blank and whitespace-only entries", () => {
    // given
    const hostConfig = {
      paths: ["", "   ", "/real/skills"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then
    expect(result).toEqual({ sources: ["/real/skills"] })
  })

  test("returns undefined when no usable sources remain", () => {
    // when
    const result = adaptHostSkillConfig({ paths: ["", "  "], urls: ["\t"] })

    // then
    expect(result).toBeUndefined()
  })

  test("returns undefined for null input", () => {
    expect(adaptHostSkillConfig(null)).toBeUndefined()
  })

  test("returns undefined for undefined input", () => {
    expect(adaptHostSkillConfig(undefined)).toBeUndefined()
  })

  test("returns undefined for non-object input", () => {
    expect(adaptHostSkillConfig("string")).toBeUndefined()
  })

  test("handles missing paths gracefully", () => {
    // when - only paths
    const pathsOnly = adaptHostSkillConfig({ paths: ["/skills"] })
    expect(pathsOnly).toEqual({ sources: ["/skills"] })
  })

  test("ignores non-string array elements", () => {
    // given
    const hostConfig = {
      paths: ["/valid", 42, null, true, "/also-valid"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then
    expect(result).toEqual({ sources: ["/valid", "/also-valid"] })
  })
})
