import { describe, test, expect } from "bun:test"
import { detectIdType, formatIdTypeError, type IdType } from "./id-types"

describe("#detectIdType", () => {
  test("given id with bg_ prefix, when detecting, then returns background", () => {
    // given
    const id = "bg_a1b2c3d4"
    // when
    const result = detectIdType(id)
    // then
    expect(result).toBe("background")
  })

  test("given id with T- prefix, when detecting, then returns task", () => {
    // given
    const id = "T-a1b2c3d4-e5f6"
    // when
    const result = detectIdType(id)
    // then
    expect(result).toBe("task")
  })

  test("given id with ses_ prefix, when detecting, then returns session", () => {
    // given
    const id = "ses_276aa5b5"
    // when
    const result = detectIdType(id)
    // then
    expect(result).toBe("session")
  })

  test("given id with ses- prefix (hyphenated), when detecting, then returns session", () => {
    // given
    const id = "ses-main"
    // when
    const result = detectIdType(id)
    // then
    expect(result).toBe("session")
  })

  test("given id with unknown prefix, when detecting, then returns unknown", () => {
    // given
    const id = "invalid_123"
    // when
    const result = detectIdType(id)
    // then
    expect(result).toBe("unknown")
  })
})

describe("#formatIdTypeError", () => {
  test("given session id, formats error with correct suggestion", () => {
    // given
    const id = "ses_276aa5b5"
    // when
    const result = formatIdTypeError(id, "background_output")
    // then
    expect(result).toContain("session id")
    expect(result).toContain("session_read")
    expect(result).toContain(id)
  })

  test("given task id, formats error with correct suggestion", () => {
    // given
    const id = "T-309e8e57-7408"
    const toolName = "background_output"
    // when
    const result = formatIdTypeError(id, toolName)
    // then
    expect(result).toContain("plan task id")
    expect(result).toContain("task_update/task_get")
    expect(result).toContain(toolName)
    expect(result).toContain(id)
  })

  test("given background id that doesn't exist, returns generic not found", () => {
    // given
    const id = "bg_notfound"
    // when
    const result = formatIdTypeError(id, "background_output")
    // then
    expect(result).toBe(`Task not found: ${id}`)
  })

  test("given unknown id, returns generic not found", () => {
    // given
    const id = "invalid_123"
    // when
    const result = formatIdTypeError(id, "background_output")
    // then
    expect(result).toBe(`Task not found: ${id}`)
  })
})
