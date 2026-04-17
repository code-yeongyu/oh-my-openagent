import { describe, expect, test } from "bun:test"

import { adaptHostSkillConfig } from "./host-skill-config"

describe("adaptHostSkillConfig", () => {
  test("filters blank and whitespace-only paths and urls", () => {
    const result = adaptHostSkillConfig({
      paths: ["", "   ", "/real/skills"],
      urls: ["\n", "https://example.com/.well-known/skills/"],
    })

    expect(result).toEqual({
      sources: [
        "/real/skills",
        "https://example.com/.well-known/skills/",
      ],
    })
  })

  test("returns undefined when no usable sources remain", () => {
    const result = adaptHostSkillConfig({
      paths: ["", "  "],
      urls: ["\t"],
    })

    expect(result).toBeUndefined()
  })
})
