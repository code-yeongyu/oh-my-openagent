import { describe, test, expect } from "bun:test"
import { isBlockedResponse, BLOCKED_KEYWORDS } from "./blocked-task-detector"

describe("isBlockedResponse", () => {
  test("returns true for 'blocked' keyword", () => {
    // #given - response with 'blocked' keyword
    const content = "This task is blocked by external dependency"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'cannot complete' keyword", () => {
    // #given - response with 'cannot complete'
    const content = "Cannot complete - requires user intervention"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'cannot proceed' keyword", () => {
    // #given - response with 'cannot proceed'
    const content = "Cannot proceed with this task"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'requires user' keyword", () => {
    // #given - response with 'requires user'
    const content = "This requires user decision"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'need user intervention' keyword", () => {
    // #given - response with 'need user intervention'
    const content = "We need user intervention to continue"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'remains blocked' keyword", () => {
    // #given - response with 'remains blocked'
    const content = "Task remains blocked after 3 attempts"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'still blocked' keyword", () => {
    // #given - response with 'still blocked'
    const content = "The issue is still blocked"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'segfault' keyword", () => {
    // #given - response with 'segfault'
    const content = "任务被 Bun segfault 阻塞"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'external blocker' keyword", () => {
    // #given - response with 'external blocker'
    const content = "Hit an external blocker that needs resolution"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for 'environment issue' keyword", () => {
    // #given - response with 'environment issue'
    const content = "This task is blocked by environment issue"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '被阻塞' keyword", () => {
    // #given - response with '被阻塞'
    const content = "任务被阻塞了"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '无法继续' keyword", () => {
    // #given - response with '无法继续'
    const content = "由于环境问题无法继续"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '需要用户介入' keyword", () => {
    // #given - response with '需要用户介入'
    const content = "这需要用户介入才能解决"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '无法完成' keyword", () => {
    // #given - response with '无法完成'
    const content = "无法完成此任务"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '仍然阻塞' keyword", () => {
    // #given - response with '仍然阻塞'
    const content = "问题仍然阻塞"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for Chinese '环境问题' keyword", () => {
    // #given - response with '环境问题'
    const content = "这是环境问题导致的"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for case-insensitive match", () => {
    // #given - response with uppercase keyword
    const content = "Task is BLOCKED by system limitation"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns false for normal continuation question", () => {
    // #given - normal continuation question
    const content = "任务完成，继续下一个?"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for fixable build error", () => {
    // #given - fixable build error
    const content = "Build failed with 3 errors. Fixing now..."
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for fixable test failure", () => {
    // #given - fixable test failure
    const content = "Test failed, fixing the implementation"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for empty string", () => {
    // #given - empty string
    const content = ""
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for normal progress update", () => {
    // #given - normal progress update
    const content = "Task in progress, implementing feature X"
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for successful completion", () => {
    // #given - successful completion message
    const content = "Task completed successfully. All tests pass."
    
    // #when - check if blocked
    const result = isBlockedResponse(content)
    
    // #then - returns false
    expect(result).toBe(false)
  })
})

describe("BLOCKED_KEYWORDS", () => {
  test("exports array of blocking keywords", () => {
    // #given - BLOCKED_KEYWORDS constant
    // #when - check type and content
    // #then - is non-empty array of strings
    expect(Array.isArray(BLOCKED_KEYWORDS)).toBe(true)
    expect(BLOCKED_KEYWORDS.length).toBeGreaterThan(0)
    expect(BLOCKED_KEYWORDS.every(k => typeof k === "string")).toBe(true)
  })

  test("includes English blocking keywords", () => {
    // #given - BLOCKED_KEYWORDS constant
    // #when - check for English keywords
    // #then - contains expected keywords
    expect(BLOCKED_KEYWORDS).toContain("blocked")
    expect(BLOCKED_KEYWORDS).toContain("cannot complete")
    expect(BLOCKED_KEYWORDS).toContain("segfault")
  })

  test("includes Chinese blocking keywords", () => {
    // #given - BLOCKED_KEYWORDS constant
    // #when - check for Chinese keywords
    // #then - contains expected keywords
    expect(BLOCKED_KEYWORDS).toContain("被阻塞")
    expect(BLOCKED_KEYWORDS).toContain("无法继续")
    expect(BLOCKED_KEYWORDS).toContain("环境问题")
  })
})
