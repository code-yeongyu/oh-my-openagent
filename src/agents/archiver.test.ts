import { describe, test, expect } from "bun:test"
import { createArchiverAgent } from "./archiver"

describe("Archiver agent prompt", () => {
  test("requires finishing and archiving skills", () => {
    // #given
    const prompt = createArchiverAgent().prompt ?? ""

    // #when / #then
    expect(prompt.toLowerCase()).toMatch(/finishing-a-development-branch/)
    expect(prompt.toLowerCase()).toMatch(/archiving-changes/)
  })

  test("forbids Codex and delegation", () => {
    // #given
    const prompt = createArchiverAgent().prompt ?? ""

    // #when / #then
    expect(prompt.toLowerCase()).toMatch(/no codex|codex.*not required|codex.*disabled/)
    expect(prompt.toLowerCase()).toMatch(/no delegation|do not delegate|no subagent/)
  })
})
