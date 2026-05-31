import { describe, expect, test } from "bun:test"

import { adaptHostSkillConfig } from "./host-skill-config"

describe("adaptHostSkillConfig", () => {
  test("converts paths and urls into SkillsConfig sources", () => {
    // given
    const hostConfig = {
      paths: ["/host/skills", "/other/skills"],
      urls: ["https://example.com/skills/"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then
    expect(result).toEqual({
      sources: ["/host/skills", "/other/skills", "https://example.com/skills/"],
    })
  })

  test("filters blank and whitespace-only entries", () => {
    // given
    const hostConfig = {
      paths: ["", "   ", "/real/skills"],
      urls: ["\n", "https://example.com/skills/"],
    }

    // when
    const result = adaptHostSkillConfig(hostConfig)

    // then
    expect(result).toEqual({
      sources: ["/real/skills", "https://example.com/skills/"],
    })
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

  test("handles missing paths or urls gracefully", () => {
    // when - only paths
    const pathsOnly = adaptHostSkillConfig({ paths: ["/skills"] })
    expect(pathsOnly).toEqual({ sources: ["/skills"] })

    // when - only urls
    const urlsOnly = adaptHostSkillConfig({ urls: ["https://example.com/skills/"] })
    expect(urlsOnly).toEqual({ sources: ["https://example.com/skills/"] })
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
