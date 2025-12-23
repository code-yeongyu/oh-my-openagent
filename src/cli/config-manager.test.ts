import { describe, expect, test } from "bun:test"

import { ANTIGRAVITY_PROVIDER_CONFIG } from "./config-manager"

describe("config-manager ANTIGRAVITY_PROVIDER_CONFIG", () => {
  test("Gemini models include full spec (limit + modalities)", () => {
    const google = (ANTIGRAVITY_PROVIDER_CONFIG as any).google
    expect(google).toBeTruthy()

    const models = google.models as Record<string, any>
    expect(models).toBeTruthy()

    const required = [
      "gemini-3-pro-high",
      "gemini-3-pro-medium",
      "gemini-3-pro-low",
      "gemini-3-flash",
      "gemini-3-flash-lite",
    ]

    for (const key of required) {
      const model = models[key]
      expect(model).toBeTruthy()
      expect(typeof model.name).toBe("string")
      expect(model.name.includes("(Antigravity)")).toBe(true)

      expect(model.limit).toBeTruthy()
      expect(typeof model.limit.context).toBe("number")
      expect(typeof model.limit.output).toBe("number")

      expect(model.modalities).toBeTruthy()
      expect(Array.isArray(model.modalities.input)).toBe(true)
      expect(Array.isArray(model.modalities.output)).toBe(true)
    }
  })
})
