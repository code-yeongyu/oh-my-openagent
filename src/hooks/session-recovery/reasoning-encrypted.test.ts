import { describe, expect, it } from "bun:test"
import { THINKING_TYPES } from "./constants"

describe("reasoning.encrypted support", () => {
  //#given reasoning.encrypted is a valid thinking-family type from Grok models
  
  it("should include reasoning.encrypted in THINKING_TYPES Set", () => {
    //#when checking if reasoning.encrypted is in THINKING_TYPES
    const result = THINKING_TYPES.has("reasoning.encrypted")
    
    //#then it should return true
    expect(result).toBe(true)
  })
  
  it("should recognize reasoning.encrypted as a ThinkingPartType", () => {
    //#given a type assertion for reasoning.encrypted
    //#when assigning to ThinkingPartType
    const thinkingType: import("./types").ThinkingPartType = "reasoning.encrypted"
    
    //#then it should compile without error
    expect(thinkingType).toBe("reasoning.encrypted")
  })
})
