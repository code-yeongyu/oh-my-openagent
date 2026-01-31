import { describe, it, expect } from "bun:test"
import {
  parseTestFile,
  hasTargetImport,
  hasTargetFunctionCall,
  isSupportedExtension,
  createAstTestMatcher,
} from "./ast-test-matcher"

describe("AstTestMatcher", () => {
  //#given a test file with imports and function calls
  const sampleTestContent = `
import { describe, it, expect } from "bun:test"
import { myFunction, helperFunc } from "./my-module"
import * as utils from "../utils"

describe("MyModule", () => {
  it("should call myFunction", () => {
    const result = myFunction("test")
    expect(result).toBe(true)
  })

  it("should use helper", () => {
    helperFunc()
    utils.doSomething()
  })
})
`

  describe("parseTestFile", () => {
    //#when parsing the test file
    //#then it should extract imports
    it("should parse test file with AST and extract imports", () => {
      const result = parseTestFile(sampleTestContent)

      expect(result.hasImport).toBe(true)
      expect(result.importedModules).toContain("bun:test")
      expect(result.importedModules).toContain("./my-module")
      expect(result.importedModules).toContain("../utils")
    })

    //#then it should extract function calls
    it("should detect function calls", () => {
      const result = parseTestFile(sampleTestContent)

      expect(result.hasFunctionCall).toBe(true)
      expect(result.calledFunctions).toContain("myFunction")
      expect(result.calledFunctions).toContain("helperFunc")
    })
  })

  describe("hasTargetImport", () => {
    //#when checking for target module import
    //#then it should return true if module is imported
    it("should detect target module import", () => {
      expect(hasTargetImport(sampleTestContent, "./my-module")).toBe(true)
      expect(hasTargetImport(sampleTestContent, "my-module")).toBe(true)
      expect(hasTargetImport(sampleTestContent, "non-existent")).toBe(false)
    })
  })

  describe("hasTargetFunctionCall", () => {
    //#when checking for target function call
    //#then it should return true if function is called
    it("should detect target function call", () => {
      expect(hasTargetFunctionCall(sampleTestContent, "myFunction")).toBe(true)
      expect(hasTargetFunctionCall(sampleTestContent, "helperFunc")).toBe(true)
      expect(hasTargetFunctionCall(sampleTestContent, "nonExistent")).toBe(false)
    })
  })

  describe("isSupportedExtension", () => {
    //#when checking file extension
    //#then it should support TS and JS files
    it("should support TypeScript and JavaScript files", () => {
      expect(isSupportedExtension("test.ts")).toBe(true)
      expect(isSupportedExtension("test.tsx")).toBe(true)
      expect(isSupportedExtension("test.js")).toBe(true)
      expect(isSupportedExtension("test.jsx")).toBe(true)
      expect(isSupportedExtension("test.py")).toBe(false)
      expect(isSupportedExtension("test.md")).toBe(false)
    })
  })

  describe("createAstTestMatcher", () => {
    //#when creating a matcher with custom config
    //#then it should use the config
    it("should create matcher with custom configuration", () => {
      const matcher = createAstTestMatcher({
        supportedExtensions: [".ts"],
      })

      expect(matcher.isSupportedExtension("test.ts")).toBe(true)
      expect(matcher.isSupportedExtension("test.js")).toBe(false)
    })
  })
})
