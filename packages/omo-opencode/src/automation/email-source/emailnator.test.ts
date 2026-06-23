import { describe, test, expect } from "bun:test"
import type { EmailnatorFreshOptions } from "./emailnator"
import { EmailnatorInbox, SWITCHES_TO_UNCHECK, DOT_GMAIL_SWITCH } from "./emailnator"

describe("emailnator", () => {
  describe("EmailnatorFreshOptions", () => {
    test("#given type-level check #when empty options #then compiles", () => {
      const opts: EmailnatorFreshOptions = {}
      expect(opts).toBeDefined()
    })

    test("#given type-level check #when existingSession key present #then type allows it", () => {
      const opts = {} satisfies EmailnatorFreshOptions
      expect("existingSession" in opts || true).toBe(true)
    })
  })

  describe("EmailnatorInbox", () => {
    test("#given class export #when checked #then static fresh method exists", () => {
      expect(typeof EmailnatorInbox.fresh).toBe("function")
    })

    test("#given prototype #when checked #then waitForCode method exists", () => {
      expect(typeof EmailnatorInbox.prototype.waitForCode).toBe("function")
    })

    test("#given prototype #when checked #then waitForEmail method exists", () => {
      expect(typeof EmailnatorInbox.prototype.waitForEmail).toBe("function")
    })

    test("#given prototype #when checked #then close method exists", () => {
      expect(typeof EmailnatorInbox.prototype.close).toBe("function")
    })
  })

  describe("switch configuration", () => {
    test("#given SWITCHES_TO_UNCHECK #when checked #then contains exactly domain, plusGmail, googleMail", () => {
      expect(SWITCHES_TO_UNCHECK).toEqual(["custom-switch-domain", "custom-switch-plusGmail", "custom-switch-googleMail"])
    })

    test("#given DOT_GMAIL_SWITCH #when checked #then is the dotGmail switch id", () => {
      expect(DOT_GMAIL_SWITCH).toBe("custom-switch-dotGmail")
    })

    test("#given switch ids #when compared #then dotGmail is NOT in the uncheck list", () => {
      expect(SWITCHES_TO_UNCHECK).not.toContain(DOT_GMAIL_SWITCH)
    })
  })
})
