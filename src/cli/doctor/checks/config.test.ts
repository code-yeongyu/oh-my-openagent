import { describe, it, expect } from "bun:test"
import * as config from "./config"

describe("config check", () => {
  describe("checkConfig", () => {
    it("returns a valid CheckResult", async () => {
      //#given config check is available
      //#when running the consolidated config check
      const result = await config.checkConfig()

      //#then should return a properly shaped CheckResult
      expect(result.name).toBe("Configuration")
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
      expect(typeof result.message).toBe("string")
      expect(Array.isArray(result.issues)).toBe(true)
    })

    it("includes issues array even when config is valid", async () => {
      //#given a normal environment
      //#when running config check
      const result = await config.checkConfig()

      //#then issues should be an array (possibly empty)
      expect(Array.isArray(result.issues)).toBe(true)
    })
  })
})
