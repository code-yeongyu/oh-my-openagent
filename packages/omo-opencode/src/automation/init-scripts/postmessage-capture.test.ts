import { describe, it, expect } from "bun:test"
import { POSTMESSAGE_CAPTURE_SCRIPT } from "./postmessage-capture"

describe("POSTMESSAGE_CAPTURE_SCRIPT", () => {
  describe("#given the exported init script", () => {
    it("#when reading name #then is postmessage-capture", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.name).toBe("postmessage-capture")
    })

    it("#when reading source #then patches EventTarget.prototype.addEventListener", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("EventTarget.prototype.addEventListener")
    })

    it("#when reading source #then patches removeEventListener", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("EventTarget.prototype.removeEventListener")
    })

    it("#when reading source #then exposes __deliverSyntheticMessage", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("__deliverSyntheticMessage")
    })

    it("#when reading source #then exposes __capturedMessageListeners", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("__capturedMessageListeners")
    })

    it("#when reading source #then captures window.onmessage property assignments", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("__capturedOnMessage")
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("Object.defineProperty(window, 'onmessage'")
    })

    it("#when reading source #then idempotent via __pmCaptureInstalled flag", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("__pmCaptureInstalled")
    })

    it("#when source is compiled as JS function body #then is syntactically valid", () => {
      expect(() => new Function(POSTMESSAGE_CAPTURE_SCRIPT.source)).not.toThrow()
    })

    it("#when default origin is omitted #then falls back to cloudflare challenges domain", () => {
      expect(POSTMESSAGE_CAPTURE_SCRIPT.source).toContain("https://challenges.cloudflare.com")
    })
  })
})
