import { describe, expect, test } from "bun:test"
import { buildWindowsToastScript } from "./session-notification-formatting"

// Tests for win32 headless/SSH resilience.
// The core invariant: the PowerShell script output wraps in try/catch so that
// WinRT failures (e.g. "notification platform is unavailable" on SSH) don't
// produce stderr output. JS-level .catch() in the sender already prevents
// crashes; these tests verify the PowerShell-level protection is in place.

describe("win32 headless/SSH resilience", () => {
  describe("buildWindowsToastScript", () => {
    test("wraps toast script in PowerShell try/catch", () => {
      const script = buildWindowsToastScript("Test Title", "Test Message")
      expect(script).toStartWith("try {")
      expect(script).toEndWith("} catch { }")
      // The WinRT call that fails on headless is still inside the try block
      expect(script).toContain("CreateToastNotifier")
    })

    test("still escapes single quotes in title and message", () => {
      const script = buildWindowsToastScript("It's a title", "It's a message")
      expect(script).toContain("It''s a title")
      expect(script).toContain("It''s a message")
      // Escaping must not break the try/catch wrapper
      expect(script).toStartWith("try {")
      expect(script).toEndWith("} catch { }")
    })

    test("generated script is a single semicolon-joined line (safe for -Command)", () => {
      const script = buildWindowsToastScript("Title", "Message")
      // Should not contain raw newlines — the sender passes this to -Command inline
      expect(script).not.toContain("\n")
      // But must still have the try/catch structure
      expect(script).toContain("try {")
      expect(script).toContain("} catch { }")
    })
  })
})
