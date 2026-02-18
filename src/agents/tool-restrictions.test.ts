import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"
import { createLibrarianAgent } from "./librarian"
import { createExploreAgent } from "./explore"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"

const TEST_MODEL = "anthropic/claude-sonnet-4-5"

describe("read-only agent tool restrictions", () => {
  const FILE_WRITE_TOOLS = ["write", "edit", "apply_patch"]

  describe("Oracle", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })

    test("denies task but allows call_omo_agent for research", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expect(permission["task"]).toBe("deny")
      expect(permission["call_omo_agent"]).toBeUndefined()
    })
  })

  describe("Librarian", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createLibrarianAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })

  describe("Explore", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createExploreAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })

  describe("Momus", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createMomusAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })

  describe("Metis", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createMetisAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })
})
