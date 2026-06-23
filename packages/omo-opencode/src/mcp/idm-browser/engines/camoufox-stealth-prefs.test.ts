import { describe, test, expect } from "bun:test"
import { STEALTH_USER_PREFS } from "./camoufox-stealth-prefs"

describe("camoufox-stealth-prefs", () => {
  describe("STEALTH_USER_PREFS", () => {
    test("#given prefs constant #when read #then disables all telemetry channels", () => {
      expect(STEALTH_USER_PREFS["toolkit.telemetry.enabled"]).toBe(false)
      expect(STEALTH_USER_PREFS["toolkit.telemetry.unified"]).toBe(false)
      expect(STEALTH_USER_PREFS["datareporting.healthreport.uploadEnabled"]).toBe(false)
      expect(STEALTH_USER_PREFS["datareporting.policy.dataSubmissionEnabled"]).toBe(false)
    })

    test("#given prefs constant #when read #then disables mozilla services", () => {
      expect(STEALTH_USER_PREFS["services.sync.enabled"]).toBe(false)
      expect(STEALTH_USER_PREFS["browser.pocket.enabled"]).toBe(false)
      expect(STEALTH_USER_PREFS["extensions.pocket.enabled"]).toBe(false)
    })

    test("#given prefs constant #when read #then keeps human-looking defaults", () => {
      expect(STEALTH_USER_PREFS["geo.enabled"]).toBe(true)
      expect(STEALTH_USER_PREFS["dom.push.enabled"]).toBe(true)
      expect(STEALTH_USER_PREFS["network.captive-portal-service.enabled"]).toBe(true)
      expect(STEALTH_USER_PREFS["browser.safebrowsing.malware.enabled"]).toBe(true)
    })

    test("#given prefs constant #when read #then permission defaults are prompt (0)", () => {
      expect(STEALTH_USER_PREFS["permissions.default.geo"]).toBe(0)
      expect(STEALTH_USER_PREFS["permissions.default.desktop-notification"]).toBe(0)
    })

    test("#given prefs constant #when read #then keeps cookies and storage at firefox defaults", () => {
      expect(STEALTH_USER_PREFS["dom.storage.enabled"]).toBe(true)
      expect(STEALTH_USER_PREFS["network.cookie.cookieBehavior"]).toBe(0)
    })
  })
})
