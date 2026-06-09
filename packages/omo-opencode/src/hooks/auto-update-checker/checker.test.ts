import { describe, test, expect } from "bun:test"
import { getLatestVersion } from "./checker"

describe("auto-update-checker/checker", () => {
  describe("getLatestVersion", () => {
    test("accepts channel parameter", async () => {
      const result = await getLatestVersion("beta")
      
      expect(typeof result === "string" || result === null).toBe(true)
    })

    test("accepts latest channel", async () => {
      const result = await getLatestVersion("latest")
      
      expect(typeof result === "string" || result === null).toBe(true)
    })

    test("works without channel (defaults to latest)", async () => {
      const result = await getLatestVersion()
      
      expect(typeof result === "string" || result === null).toBe(true)
    })
  })
})
