import { describe, expect, test } from "bun:test"
import { isAgentExcludedFromOmoInjection } from "./excluded-agents"

describe("isAgentExcludedFromOmoInjection (issue #3735)", () => {
  test("returns false when excluded_agents is undefined", () => {
    expect(isAgentExcludedFromOmoInjection("cybersec", undefined)).toBe(false)
  })

  test("returns false when excluded_agents is empty", () => {
    expect(isAgentExcludedFromOmoInjection("cybersec", [])).toBe(false)
  })

  test("returns false when agent name is undefined", () => {
    expect(isAgentExcludedFromOmoInjection(undefined, ["cybersec"])).toBe(false)
  })

  test("returns false when agent name is empty / whitespace only", () => {
    expect(isAgentExcludedFromOmoInjection("", ["cybersec"])).toBe(false)
    expect(isAgentExcludedFromOmoInjection("   ", ["cybersec"])).toBe(false)
  })

  test("matches exact lowercase agent name", () => {
    expect(isAgentExcludedFromOmoInjection("cybersec", ["cybersec"])).toBe(true)
  })

  test("matches case-insensitively", () => {
    expect(isAgentExcludedFromOmoInjection("CyberSec", ["cybersec"])).toBe(true)
    expect(isAgentExcludedFromOmoInjection("cybersec", ["CyberSec"])).toBe(true)
    expect(isAgentExcludedFromOmoInjection("CYBERSEC", ["CyberSec"])).toBe(true)
  })

  test("treats underscores, spaces, and hyphens interchangeably", () => {
    expect(isAgentExcludedFromOmoInjection("cyber-sec", ["cyber_sec"])).toBe(true)
    expect(isAgentExcludedFromOmoInjection("cyber sec", ["cyber-sec"])).toBe(true)
    expect(isAgentExcludedFromOmoInjection("cyber_sec", ["cyber sec"])).toBe(true)
  })

  test("returns false for non-matching names", () => {
    expect(isAgentExcludedFromOmoInjection("sisyphus", ["cybersec"])).toBe(false)
  })

  test("matches any agent in the list, not just the first", () => {
    expect(isAgentExcludedFromOmoInjection("audit", ["cybersec", "audit", "review"])).toBe(true)
  })

  test("does not partial-match (cyber should not match cybersec)", () => {
    expect(isAgentExcludedFromOmoInjection("cyber", ["cybersec"])).toBe(false)
    expect(isAgentExcludedFromOmoInjection("cybersec", ["cyber"])).toBe(false)
  })
})
