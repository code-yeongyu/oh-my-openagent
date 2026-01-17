/**
 * TDD Guard Hook Tests
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { createTddGuardHook } from "./index"
import { determineRiskTier, shouldBlockEdit, matchesIgnorePattern } from "./risk-validator"
import { isTestFile, detectLanguage, getExpectedTestFilePath } from "./language-adapter"
import { checkTestQuality } from "./test-quality-checker"

describe("TDD Guard Hook", () => {
  describe("Risk Tier Detection", () => {
    test("should classify .md files as Tier 0", () => {
      // #given - a markdown file
      const filePath = "README.md"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 0
      expect(result.tier).toBe(0)
      expect(result.requiresTest).toBe(false)
    })

    test("should classify LICENSE as Tier 0", () => {
      // #given - a LICENSE file
      const filePath = "LICENSE"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 0
      expect(result.tier).toBe(0)
    })

    test("should classify .json files as Tier 1", () => {
      // #given - a JSON config file
      const filePath = "package.json"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 1
      expect(result.tier).toBe(1)
      expect(result.requiresTest).toBe(false)
    })

    test("should classify .css files as Tier 1", () => {
      // #given - a CSS file
      const filePath = "src/styles/main.css"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 1
      expect(result.tier).toBe(1)
    })

    test("should classify /api/ files as Tier 3", () => {
      // #given - an API route file
      const filePath = "src/api/users.ts"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 3 (strict TDD)
      expect(result.tier).toBe(3)
      expect(result.requiresTest).toBe(true)
      expect(result.allowsExemption).toBe(false)
    })

    test("should classify /services/ files as Tier 3", () => {
      // #given - a service file
      const filePath = "src/services/auth-service.ts"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 3
      expect(result.tier).toBe(3)
    })

    test("should classify /auth/ files as Tier 3", () => {
      // #given - an auth file
      const filePath = "src/auth/oauth.ts"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 3
      expect(result.tier).toBe(3)
    })

    test("should classify normal .ts files as Tier 2", () => {
      // #given - a normal TypeScript file
      const filePath = "src/utils/helper.ts"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should be Tier 2
      expect(result.tier).toBe(2)
      expect(result.requiresTest).toBe(true)
      expect(result.allowsExemption).toBe(true)
    })

    test("should handle Windows-style paths", () => {
      // #given - a Windows-style path
      const filePath = "src\\api\\users.ts"

      // #when - determining risk tier
      const result = determineRiskTier(filePath)

      // #then - should correctly identify as Tier 3
      expect(result.tier).toBe(3)
    })
  })

  describe("Block Decision", () => {
    test("should not block Tier 0 files", () => {
      // #given - a Tier 0 file result
      const tier = determineRiskTier("README.md")

      // #when - checking if should block
      const result = shouldBlockEdit(tier, false, false)

      // #then - should not block
      expect(result.blocked).toBe(false)
    })

    test("should not block Tier 1 files", () => {
      // #given - a Tier 1 file result
      const tier = determineRiskTier("styles.css")

      // #when - checking if should block
      const result = shouldBlockEdit(tier, false, false)

      // #then - should not block
      expect(result.blocked).toBe(false)
    })

    test("should block Tier 2 files without test or exemption", () => {
      // #given - a Tier 2 file without test
      const tier = determineRiskTier("src/utils/helper.ts")

      // #when - checking if should block
      const result = shouldBlockEdit(tier, false, false)

      // #then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Tier 2")
    })

    test("should not block Tier 2 files with exemption", () => {
      // #given - a Tier 2 file with exemption
      const tier = determineRiskTier("src/utils/helper.ts")

      // #when - checking if should block with exemption
      const result = shouldBlockEdit(tier, false, true)

      // #then - should not block
      expect(result.blocked).toBe(false)
    })

    test("should not block Tier 2 files with failing test", () => {
      // #given - a Tier 2 file with failing test
      const tier = determineRiskTier("src/utils/helper.ts")

      // #when - checking if should block with failing test
      const result = shouldBlockEdit(tier, true, false)

      // #then - should not block
      expect(result.blocked).toBe(false)
    })

    test("should block Tier 3 files without failing test", () => {
      // #given - a Tier 3 file without failing test
      const tier = determineRiskTier("src/api/users.ts")

      // #when - checking if should block
      const result = shouldBlockEdit(tier, false, false)

      // #then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Tier 3")
    })

    test("should block Tier 3 files even with exemption", () => {
      // #given - a Tier 3 file with exemption (not allowed)
      const tier = determineRiskTier("src/api/users.ts")

      // #when - checking if should block with exemption
      const result = shouldBlockEdit(tier, false, true)

      // #then - should still block (Tier 3 doesn't allow exemption)
      expect(result.blocked).toBe(true)
    })

    test("should not block Tier 3 files with failing test", () => {
      // #given - a Tier 3 file with failing test
      const tier = determineRiskTier("src/api/users.ts")

      // #when - checking if should block with failing test
      const result = shouldBlockEdit(tier, true, false)

      // #then - should not block
      expect(result.blocked).toBe(false)
    })
  })

  describe("Test File Detection", () => {
    test("should detect .test.ts files", () => {
      expect(isTestFile("src/utils/helper.test.ts")).toBe(true)
    })

    test("should detect .spec.ts files", () => {
      expect(isTestFile("src/utils/helper.spec.ts")).toBe(true)
    })

    test("should detect __tests__ directory files", () => {
      expect(isTestFile("src/__tests__/helper.ts")).toBe(true)
    })

    test("should not detect regular .ts files as test files", () => {
      expect(isTestFile("src/utils/helper.ts")).toBe(false)
    })

    test("should detect Python test files", () => {
      expect(isTestFile("test_helper.py")).toBe(true)
      expect(isTestFile("helper_test.py")).toBe(true)
    })

    test("should detect Go test files", () => {
      expect(isTestFile("helper_test.go")).toBe(true)
    })
  })

  describe("Language Detection", () => {
    test("should detect TypeScript", () => {
      expect(detectLanguage("file.ts")).toBe("typescript")
      expect(detectLanguage("file.tsx")).toBe("typescript")
    })

    test("should detect JavaScript", () => {
      expect(detectLanguage("file.js")).toBe("javascript")
      expect(detectLanguage("file.jsx")).toBe("javascript")
    })

    test("should detect Python", () => {
      expect(detectLanguage("file.py")).toBe("python")
    })

    test("should detect Go", () => {
      expect(detectLanguage("file.go")).toBe("go")
    })

    test("should detect Rust", () => {
      expect(detectLanguage("file.rs")).toBe("rust")
    })

    test("should return unknown for unrecognized extensions", () => {
      expect(detectLanguage("file.xyz")).toBe("unknown")
    })
  })

  describe("Ignore Patterns", () => {
    test("should match *.md pattern", () => {
      expect(matchesIgnorePattern("README.md", ["*.md"])).toBe(true)
    })

    test("should match *.json pattern", () => {
      expect(matchesIgnorePattern("package.json", ["*.json"])).toBe(true)
    })

    test("should not match non-matching patterns", () => {
      expect(matchesIgnorePattern("src/app.ts", ["*.md", "*.json"])).toBe(false)
    })
  })

  describe("Test Quality Checker", () => {
    test("should reject tests with trivial assertions", () => {
      // #given - test with trivial assertion
      const content = `
        test('trivial', () => {
          expect(true).toBe(true);
        });
      `

      // #when - checking quality
      const result = checkTestQuality(content, "test.test.ts", {
        rejectEmptyTests: true,
        rejectMissingAssertions: true,
        rejectTrivialAssertions: true,
      })

      // #then - should fail
      expect(result.ok).toBe(false)
      expect(result.errors).toContain("Trivial assertion detected (e.g., expect(true).toBe(true))")
    })

    test("should accept tests with real assertions", () => {
      // #given - test with real assertions
      const content = `
        test('real test', () => {
          const result = add(1, 2);
          expect(result).toBe(3);
        });
      `

      // #when - checking quality
      const result = checkTestQuality(content, "test.test.ts", {
        rejectEmptyTests: true,
        rejectMissingAssertions: true,
        rejectTrivialAssertions: true,
      })

      // #then - should pass
      expect(result.ok).toBe(true)
    })
  })

  describe("Hook Integration", () => {
    let hook: ReturnType<typeof createTddGuardHook>

    beforeEach(() => {
      hook = createTddGuardHook(
        { cwd: "/test" },
        { config: { enabled: true } }
      )
    })

    test("should not block non-edit/write tools", async () => {
      // #given - a read tool call
      const input = { tool: "read", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
      } = { args: { filePath: "src/api/users.ts" } }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should not block
      expect(output.blocked).toBeUndefined()
    })

    test("should not block test files", async () => {
      // #given - editing a test file
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
      } = { args: { filePath: "src/api/users.test.ts" } }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should not block
      expect(output.blocked).toBeUndefined()
    })

    test("should block Tier 2 source files without test", async () => {
      // #given - editing a Tier 2 source file
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
        messages?: Array<{ role: string; content: string }>
      } = { args: { filePath: "src/utils/helper.ts", newString: "new code" } }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should block and inject skill
      expect(output.blocked).toBe(true)
      expect(output.message).toContain("TDD Guard")
      expect(output.messages?.length).toBeGreaterThan(0)
      expect(output.messages?.[0].content).toContain("TDD SKILL")
    })

    test("should not block when TDD-EXEMPT comment is present", async () => {
      // #given - editing with exemption comment
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
      } = {
        args: {
          filePath: "src/utils/helper.ts",
          newString: '// TDD-EXEMPT: reason="Generated code"\nconst x = 1;',
        },
      }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should not block
      expect(output.blocked).toBeUndefined()
    })

    test("should block Tier 3 files even with exemption", async () => {
      // #given - editing Tier 3 file with exemption
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
      } = {
        args: {
          filePath: "src/api/users.ts",
          newString: '// TDD-EXEMPT: reason="Quick fix"\nconst x = 1;',
        },
      }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should still block (Tier 3 doesn't allow exemption)
      expect(output.blocked).toBe(true)
    })
  })

  describe("Expected Test File Path", () => {
    test("should generate test path for TypeScript files", () => {
      expect(getExpectedTestFilePath("src/utils/helper.ts")).toBe("src/utils/helper.test.ts")
    })

    test("should generate test path for JavaScript files", () => {
      expect(getExpectedTestFilePath("src/utils/helper.js")).toBe("src/utils/helper.test.js")
    })

    test("should generate test path for Python files", () => {
      expect(getExpectedTestFilePath("src/utils/helper.py")).toBe("src/utils/test_helper.py")
    })

    test("should generate test path for Go files", () => {
      expect(getExpectedTestFilePath("pkg/utils/helper.go")).toBe("pkg/utils/helper_test.go")
    })

    test("should return null for unknown extensions", () => {
      expect(getExpectedTestFilePath("file.xyz")).toBeNull()
    })
  })
})
