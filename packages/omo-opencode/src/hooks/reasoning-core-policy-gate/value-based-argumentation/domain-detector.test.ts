/// <reference path="../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { detectDomain } from "./domain-detector"

describe("detectDomain", () => {
  it("#when healthcare terms appear #then returns healthcare", () => {
    expect(detectDomain("Choose the safest treatment plan for a hospital patient after diagnosis.")).toBe("healthcare")
  })

  it("#when legal terms appear #then returns legal", () => {
    expect(detectDomain("Decide whether this court filing creates a binding precedent for the client.")).toBe("legal")
  })

  it("#when no domain keywords match #then returns general", () => {
    expect(detectDomain("Choose the best internal rollout plan for a new feature.")).toBe("general")
  })
})
