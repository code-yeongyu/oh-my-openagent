import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { validateNonTuiArgs } from "./install-validators"
import type { InstallArgs } from "./types"

function createArgs(overrides: Partial<InstallArgs> = {}): InstallArgs {
  return {
    tui: false,
    claude: "no",
    openai: "no",
    gemini: "no",
    copilot: "no",
    opencodeZen: "no",
    zaiCodingPlan: "no",
    kimiForCoding: "no",
    opencodeGo: "no",
    skipAuth: false,
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.CI
})

describe("validateNonTuiArgs", () => {
  test("rejects invalid --opencode-go values", () => {
    // #given
    const args = createArgs({ opencodeGo: "maybe" as InstallArgs["opencodeGo"] })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Invalid --opencode-go value: maybe (expected: no, yes)")
  })
})

describe("printBox", () => {
  test("uses ASCII borders in CI", async () => {
    // given
    process.env.CI = "true"
    const logs: string[] = []
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "))
    })
    const { printBox } = await import(`./install-validators?ci-box-${Date.now()}`)

    // when
    printBox("hello", "Title")

    // then
    expect(logSpy).toHaveBeenCalled()
    expect(logs.join("\n")).toContain("+")
    expect(logs.join("\n")).toContain("| hello")
    expect(logs.join("\n")).not.toContain("┌")
    expect(logs.join("\n")).not.toContain("│")
  })
})
