import { describe, it, expect } from "bun:test"
import { sanitizeDisplayNameForMarkdown } from "./markdown-display-name"

describe("sanitizeDisplayNameForMarkdown", () => {
  it("#given clean name #when sanitized #then returns unchanged", () => {
    expect(sanitizeDisplayNameForMarkdown("Peacock")).toBe("Peacock")
  })

  it("#given name with backticks #when sanitized #then strips backticks", () => {
    expect(sanitizeDisplayNameForMarkdown("Pea`cock")).toBe("Peacock")
  })

  it("#given name with pipe #when sanitized #then strips pipe", () => {
    expect(sanitizeDisplayNameForMarkdown("Pea|cock")).toBe("Peacock")
  })

  it("#given name with newlines #when sanitized #then strips newlines", () => {
    expect(sanitizeDisplayNameForMarkdown("Pea\ncock")).toBe("Peacock")
    expect(sanitizeDisplayNameForMarkdown("Pea\r\ncock")).toBe("Peacock")
  })

  it("#given name with mixed unsafe chars #when sanitized #then strips all", () => {
    expect(sanitizeDisplayNameForMarkdown("`Pea|co\nck`")).toBe("Peacock")
  })

  it("#given name with surrounding whitespace #when sanitized #then trims", () => {
    expect(sanitizeDisplayNameForMarkdown("  Peacock  ")).toBe("Peacock")
  })
})
