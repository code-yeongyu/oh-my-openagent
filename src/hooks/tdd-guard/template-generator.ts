import { existsSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"

/**
 * Options for generating test templates
 */
export interface TestTemplateOptions {
  /** The source file path to generate tests for */
  sourceFile: string
  /** Project root directory */
  projectRoot?: string
  /** Test file suffix (default: .test) */
  testSuffix?: string
  /** Whether to use TypeScript (default: auto-detect from extension) */
  typescript?: boolean
}

/**
 * Result of test template generation
 */
export interface TestTemplateResult {
  /** Whether the template was generated */
  generated: boolean
  /** The test file path */
  testFilePath: string
  /** The template content (if generated) */
  content?: string
  /** Reason if not generated */
  reason?: string
}

/**
 * Generate a test file path from a source file path
 */
export function getTestFilePath(sourceFile: string, testSuffix = ".test"): string {
  const ext = extname(sourceFile)
  const base = basename(sourceFile, ext)
  const dir = dirname(sourceFile)
  return join(dir, `${base}${testSuffix}${ext}`)
}

/**
 * Check if a test file already exists
 */
export function testFileExists(testFilePath: string): boolean {
  return existsSync(testFilePath)
}

/**
 * Extract the module name from a file path for imports
 */
export function getModuleName(sourceFile: string): string {
  const ext = extname(sourceFile)
  const base = basename(sourceFile, ext)
  return base
}

/**
 * Generate the relative import path from test file to source file
 */
export function getRelativeImportPath(sourceFile: string): string {
  const ext = extname(sourceFile)
  const base = basename(sourceFile, ext)
  return `./${base}`
}

/**
 * Generate a test template for a source file
 */
export function generateTestTemplate(options: TestTemplateOptions): TestTemplateResult {
  const { sourceFile, testSuffix = ".test" } = options
  
  const testFilePath = getTestFilePath(sourceFile, testSuffix)
  
  // Check if test file already exists
  if (testFileExists(testFilePath)) {
    return {
      generated: false,
      testFilePath,
      reason: "Test file already exists",
    }
  }
  
  const moduleName = getModuleName(sourceFile)
  const importPath = getRelativeImportPath(sourceFile)
  const ext = extname(sourceFile)
  const isTypeScript = options.typescript ?? (ext === ".ts" || ext === ".tsx")
  
  // Generate template content
  const content = generateTemplateContent(moduleName, importPath, isTypeScript)
  
  return {
    generated: true,
    testFilePath,
    content,
  }
}

/**
 * Generate the actual test file content
 */
function generateTemplateContent(
  moduleName: string,
  importPath: string,
  isTypeScript: boolean
): string {
  const importStatement = isTypeScript
    ? `import { describe, it, expect } from "bun:test"
import { /* TODO: add exports */ } from "${importPath}"`
    : `const { describe, it, expect } = require("bun:test")
const { /* TODO: add exports */ } = require("${importPath}")`

  return `${importStatement}

describe("${moduleName}", () => {
  describe("TODO: describe feature", () => {
    it("#then should TODO: describe expected behavior", () => {
      //#given
      // TODO: Set up test preconditions

      //#when
      // TODO: Execute the action being tested

      //#then
      // TODO: Assert expected outcomes
      expect(true).toBe(true) // Replace with actual assertion
    })
  })
})
`
}

/**
 * Get suggested test cases based on common patterns
 */
export function getSuggestedTestCases(moduleName: string): string[] {
  return [
    `should create ${moduleName} successfully`,
    `should handle empty input`,
    `should throw error for invalid input`,
    `should return expected output for valid input`,
  ]
}
