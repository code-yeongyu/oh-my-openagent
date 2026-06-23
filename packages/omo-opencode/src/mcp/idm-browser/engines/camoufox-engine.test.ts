import { describe, test, expect } from "bun:test"
import type { CamoufoxLaunchOptions } from "./camoufox-engine"

describe("camoufox-engine", () => {
  describe("CamoufoxLaunchOptions", () => {
    test("#given type-level check #when option shape defined #then compiles", () => {
      const opts: CamoufoxLaunchOptions = {
        headless: true,
        humanize: 1.5,
        geoip: true,
        locale: "it-IT",
        os: ["windows"],
        block_images: false,
        proxy: "http://user:pass@pr.oxylabs.io:7777",
      }
      expect(opts.headless).toBe(true)
    })

    test("#given proxy object form #when used #then type accepts it", () => {
      const opts: CamoufoxLaunchOptions = {
        proxy: { server: "http://pr.oxylabs.io:7777", username: "user", password: "pass" },
      }
      expect(opts.proxy).toBeDefined()
    })
  })
})
