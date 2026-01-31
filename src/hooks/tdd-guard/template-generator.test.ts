import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  generateTestTemplate,
  getTestFilePath,
  testFileExists,
  getModuleName,
  getRelativeImportPath,
  getSuggestedTestCases,
} from "./template-generator"

describe("template-generator", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `tdd-template-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("getTestFilePath", () => {
    it("#then should generate test file path with .test suffix", () => {
      //#given
      const sourceFile = "src/utils/helper.ts"

      //#when
      const result = getTestFilePath(sourceFile)

      //#then
      // Normalize path separators for cross-platform compatibility
      expect(result.replace(/\\/g, "/")).toBe("src/utils/helper.test.ts")
    })

    it("#then should handle custom test suffix", () => {
      //#given
      const sourceFile = "src/utils/helper.ts"

      //#when
      const result = getTestFilePath(sourceFile, ".spec")

      //#then
      expect(result.replace(/\\/g, "/")).toBe("src/utils/helper.spec.ts")
    })

    it("#then should handle .js files", () => {
      //#given
      const sourceFile = "lib/utils.js"

      //#when
      const result = getTestFilePath(sourceFile)

      //#then
      expect(result.replace(/\\/g, "/")).toBe("lib/utils.test.js")
    })
  })

  describe("testFileExists", () => {
    it("#then should return true when file exists", () => {
      //#given
      const filePath = join(testDir, "existing.test.ts")
      writeFileSync(filePath, "// test file")

      //#when
      const result = testFileExists(filePath)

      //#then
      expect(result).toBe(true)
    })

    it("#then should return false when file does not exist", () => {
      //#given
      const filePath = join(testDir, "nonexistent.test.ts")

      //#when
      const result = testFileExists(filePath)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("getModuleName", () => {
    it("#then should extract module name from path", () => {
      //#given
      const sourceFile = "src/utils/helper.ts"

      //#when
      const result = getModuleName(sourceFile)

      //#then
      expect(result).toBe("helper")
    })

    it("#then should handle nested paths", () => {
      //#given
      const sourceFile = "src/features/auth/login-handler.ts"

      //#when
      const result = getModuleName(sourceFile)

      //#then
      expect(result).toBe("login-handler")
    })
  })

  describe("getRelativeImportPath", () => {
    it("#then should generate relative import path", () => {
      //#given
      const sourceFile = "src/utils/helper.ts"

      //#when
      const result = getRelativeImportPath(sourceFile)

      //#then
      expect(result).toBe("./helper")
    })
  })

  describe("generateTestTemplate", () => {
    it("#then should generate template with describe/it structure", () => {
      //#given
      const sourceFile = join(testDir, "helper.ts")
      writeFileSync(sourceFile, "export function helper() {}")

      //#when
      const result = generateTestTemplate({ sourceFile })

      //#then
      expect(result.generated).toBe(true)
      expect(result.content).toContain("describe(")
      expect(result.content).toContain("it(")
      expect(result.content).toContain("expect(")
    })

    it("#then should include import for target file", () => {
      //#given
      const sourceFile = join(testDir, "helper.ts")
      writeFileSync(sourceFile, "export function helper() {}")

      //#when
      const result = generateTestTemplate({ sourceFile })

      //#then
      expect(result.content).toContain('import {')
      expect(result.content).toContain('./helper')
    })

    it("#then should not overwrite existing test file", () => {
      //#given
      const sourceFile = join(testDir, "existing.ts")
      const testFile = join(testDir, "existing.test.ts")
      writeFileSync(sourceFile, "export function existing() {}")
      writeFileSync(testFile, "// existing test")

      //#when
      const result = generateTestTemplate({ sourceFile })

      //#then
      expect(result.generated).toBe(false)
      expect(result.reason).toBe("Test file already exists")
    })

    it("#then should follow project test path convention", () => {
      //#given
      const sourceFile = join(testDir, "feature.ts")
      writeFileSync(sourceFile, "export function feature() {}")

      //#when
      const result = generateTestTemplate({ sourceFile })

      //#then
      expect(result.testFilePath).toBe(join(testDir, "feature.test.ts"))
    })

    it("#then should include BDD comments in template", () => {
      //#given
      const sourceFile = join(testDir, "bdd.ts")
      writeFileSync(sourceFile, "export function bdd() {}")

      //#when
      const result = generateTestTemplate({ sourceFile })

      //#then
      expect(result.content).toContain("//#given")
      expect(result.content).toContain("//#when")
      expect(result.content).toContain("//#then")
    })

    it("#then should use require for JavaScript files", () => {
      //#given
      const sourceFile = join(testDir, "legacy.js")
      writeFileSync(sourceFile, "module.exports = {}")

      //#when
      const result = generateTestTemplate({ sourceFile, typescript: false })

      //#then
      expect(result.content).toContain("require(")
    })
  })

  describe("getSuggestedTestCases", () => {
    it("#then should return suggested test cases", () => {
      //#given
      const moduleName = "UserService"

      //#when
      const result = getSuggestedTestCases(moduleName)

      //#then
      expect(result).toBeArray()
      expect(result.length).toBeGreaterThan(0)
      expect(result.some(t => t.includes("UserService"))).toBe(true)
    })
  })
})
