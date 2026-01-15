import { describe, expect, test } from "bun:test"
import { normalizeArgs, validateArgs } from "./tools"

describe("look-at tool", () => {
  describe("normalizeArgs", () => {
    // #given LLM이 file_path 대신 path를 사용할 수 있음
    // #when path 파라미터로 호출
    // #then file_path로 정규화되어야 함
    test("normalizes path to file_path for LLM compatibility", () => {
      const args = { path: "/some/file.png", goal: "analyze" }
      const normalized = normalizeArgs(args as any)
      expect(normalized.file_path).toBe("/some/file.png")
      expect(normalized.goal).toBe("analyze")
    })

    // #given 정상적인 file_path 사용
    // #when file_path 파라미터로 호출
    // #then 그대로 유지
    test("keeps file_path when properly provided", () => {
      const args = { file_path: "/correct/path.pdf", goal: "extract" }
      const normalized = normalizeArgs(args)
      expect(normalized.file_path).toBe("/correct/path.pdf")
    })

    // #given 둘 다 제공된 경우
    // #when file_path와 path 모두 있음
    // #then file_path 우선
    test("prefers file_path over path when both provided", () => {
      const args = { file_path: "/preferred.png", path: "/fallback.png", goal: "test" }
      const normalized = normalizeArgs(args as any)
      expect(normalized.file_path).toBe("/preferred.png")
    })
  })

  describe("validateArgs", () => {
    // #given 유효한 인자
    // #when 검증
    // #then null 반환 (에러 없음)
    test("returns null for valid args", () => {
      const args = { file_path: "/valid/path.png", goal: "analyze" }
      expect(validateArgs(args)).toBeNull()
    })

    // #given file_path 누락
    // #when 검증
    // #then 명확한 에러 메시지
    test("returns error when file_path is missing", () => {
      const args = { goal: "analyze" } as any
      const error = validateArgs(args)
      expect(error).toContain("file_path")
      expect(error).toContain("required")
    })

    // #given goal 누락
    // #when 검증
    // #then 명확한 에러 메시지
    test("returns error when goal is missing", () => {
      const args = { file_path: "/some/path.png" } as any
      const error = validateArgs(args)
      expect(error).toContain("goal")
      expect(error).toContain("required")
    })

    // #given file_path가 빈 문자열
    // #when 검증
    // #then 에러 반환
    test("returns error when file_path is empty string", () => {
      const args = { file_path: "", goal: "analyze" }
      const error = validateArgs(args)
      expect(error).toContain("file_path")
    })
  })
})
