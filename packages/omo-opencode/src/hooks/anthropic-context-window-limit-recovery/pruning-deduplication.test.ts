import { describe, test, expect } from "bun:test"
import { createToolSignature } from "./pruning-deduplication"

describe("createToolSignature", () => {
  test("creates consistent signature for same input", () => {
    const input1 = { filePath: "/foo/bar.ts", content: "hello" }
    const input2 = { content: "hello", filePath: "/foo/bar.ts" }
    
    const sig1 = createToolSignature("read", input1)
    const sig2 = createToolSignature("read", input2)
    
    expect(sig1).toBe(sig2)
  })
  
  test("creates different signature for different input", () => {
    const input1 = { filePath: "/foo/bar.ts" }
    const input2 = { filePath: "/foo/baz.ts" }
    
    const sig1 = createToolSignature("read", input1)
    const sig2 = createToolSignature("read", input2)
    
    expect(sig1).not.toBe(sig2)
  })
  
  test("includes tool name in signature", () => {
    const input = { filePath: "/foo/bar.ts" }
    
    const sig1 = createToolSignature("read", input)
    const sig2 = createToolSignature("write", input)
    
    expect(sig1).not.toBe(sig2)
  })
})
