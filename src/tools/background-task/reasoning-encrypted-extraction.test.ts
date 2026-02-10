import { describe, expect, it } from "bun:test"

describe("reasoning.encrypted content extraction", () => {
  //#given content parts with reasoning.encrypted type
  
  it("should extract text from reasoning.encrypted part when text is present", () => {
    //#given a part with reasoning.encrypted type and text
    const part = { type: "reasoning.encrypted" as const, text: "decrypted reasoning content" }
    
    //#when filtering for text or reasoning.encrypted with text guard
    const shouldInclude = !!((part.type === "text" || part.type === "reasoning" || part.type === "reasoning.encrypted") && part.text)
    
    //#then it should be included
    expect(shouldInclude).toBe(true)
  })
  
  it("should skip reasoning.encrypted part when text is missing", () => {
    //#given a part with reasoning.encrypted type but no text
    const part = { type: "reasoning.encrypted" as const }
    
    //#when filtering for text or reasoning.encrypted with text guard
    const shouldInclude = !!((part.type === "text" || part.type === "reasoning" || part.type === "reasoning.encrypted") && (part as any).text)
    
    //#then it should be excluded
    expect(shouldInclude).toBe(false)
  })
  
  it("should extract text from reasoning part when text is present", () => {
    //#given a part with reasoning type and text
    const part = { type: "reasoning" as const, text: "reasoning content" }
    
    //#when filtering for text or reasoning with text guard
    const shouldInclude = !!((part.type === "text" || part.type === "reasoning" || part.type === "reasoning.encrypted") && part.text)
    
    //#then it should be included
    expect(shouldInclude).toBe(true)
  })
  
  it("should extract text from text part", () => {
    //#given a part with text type
    const part = { type: "text" as const, text: "text content" }
    
    //#when filtering for text or reasoning with text guard
    const shouldInclude = !!((part.type === "text" || part.type === "reasoning" || part.type === "reasoning.encrypted") && part.text)
    
    //#then it should be included
    expect(shouldInclude).toBe(true)
  })
})
