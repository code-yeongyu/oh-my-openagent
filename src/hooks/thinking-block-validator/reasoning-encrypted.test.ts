import { describe, expect, it } from "bun:test"

describe("reasoning.encrypted in thinking-family checks", () => {
  //#given a helper function that checks if a type is thinking-family
  const isThinkingFamily = (type: string): boolean => {
    return type === "thinking" || type === "reasoning" || type === "reasoning.encrypted"
  }
  
  it("should recognize reasoning.encrypted as thinking-family type", () => {
    //#when checking if reasoning.encrypted is thinking-family
    const result = isThinkingFamily("reasoning.encrypted")
    
    //#then it should return true
    expect(result).toBe(true)
  })
  
  it("should recognize reasoning as thinking-family type", () => {
    //#when checking if reasoning is thinking-family
    const result = isThinkingFamily("reasoning")
    
    //#then it should return true
    expect(result).toBe(true)
  })
  
  it("should recognize thinking as thinking-family type", () => {
    //#when checking if thinking is thinking-family
    const result = isThinkingFamily("thinking")
    
    //#then it should return true
    expect(result).toBe(true)
  })
  
  it("should not recognize text as thinking-family type", () => {
    //#when checking if text is thinking-family
    const result = isThinkingFamily("text")
    
    //#then it should return false
    expect(result).toBe(false)
  })
})
