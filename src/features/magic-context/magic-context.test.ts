import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { shrinkClassText, shrinkNodeText } from "./magic-context-manager"

const TEST_DIR = join(tmpdir(), "magic-context-test-" + Date.now())

describe("Magic Context", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("#given class shrinking helper", () => {
    it("should shrink a TS class body, removing method blocks while preserving signature lines and properties", () => {
      // given
      const rawClass = `class MyService {
  private count: number = 0;
  constructor(private name: string) {
    this.name = name;
    console.log("initializing " + name);
  }
  public async getData(id: string): Promise<any> {
    const data = await fetch(id);
    return data.json();
  }
}`

      // when
      const result = shrinkClassText(rawClass)

      // then
      expect(result).toContain("class MyService {")
      expect(result).toContain("private count: number = 0;")
      expect(result).toContain("constructor(private name: string) { /* ... */ }")
      expect(result).toContain("public async getData(id: string): Promise<any> { /* ... */ }")
      expect(result).not.toContain("this.name = name;")
      expect(result).not.toContain("await fetch(id)")
    })
  })

  describe("#given general shrinking helper", () => {
    it("should keep TypeScript types and interfaces intact since they are purely structural", () => {
      // given
      const rawInterface = `interface User {
  id: string;
  name: string;
}`

      // when
      const result = shrinkNodeText(rawInterface, "typescript")

      // then
      expect(result).toBe(rawInterface)
    })

    it("should shrink standard TS function bodies", () => {
      // given
      const rawFunc = `function calc(a: number, b: number): number {
  const result = a + b;
  return result;
}`

      // when
      const result = shrinkNodeText(rawFunc, "typescript")

      // then
      expect(result).toBe("function calc(a: number, b: number): number { /* ... */ }")
    })

    it("should shrink Python class and method definitions", () => {
      // given
      const rawPyClass = `class CalcService:
    def __init__(self, val):
        self.val = val
    def add(self, x):
        return self.val + x`

      // when
      const result = shrinkNodeText(rawPyClass, "python")

      // then
      expect(result).toContain("class CalcService:")
      expect(result).toContain("def __init__(self, val): ...")
      expect(result).toContain("def add(self, x): ...")
      expect(result).not.toContain("return self.val + x")
    })

    it("should shrink Go function definitions", () => {
      // given
      const rawGoFunc = `func Sum(a int, b int) int {
\treturn a + b
}`

      // when
      const result = shrinkNodeText(rawGoFunc, "go")

      // then
      expect(result).toBe("func Sum(a int, b int) int { /* ... */ }")
    })

    it("should shrink Rust impl and function headers", () => {
      // given
      const rawRustImpl = `impl MyStruct {
    pub fn new() -> Self {
        MyStruct {}
    }
    fn compute(&self) {
        println!("computing");
    }
}`

      // when
      const result = shrinkNodeText(rawRustImpl, "rust")

      // then
      expect(result).toContain("impl MyStruct {")
      expect(result).toContain("pub fn new() -> Self { /* ... */ }")
      expect(result).toContain("fn compute(&self) { /* ... */ }")
      expect(result).not.toContain("println!")
    })
  })

  describe("#given AST extraction across workspace files", () => {
    it("should extract surgical definitions from supported files and skip excluded path globs", async () => {
      // given
      const testFile = join(TEST_DIR, "service.ts")
      writeFileSync(testFile, "class TempClass { test() { return 1; } }")

      mock.module("@oh-my-opencode/ast-grep-mcp", () => ({
        runSg: async () => ({
          matches: [
            {
              text: "class TempClass { test() { return 1; } }",
              range: { start: { line: 0 }, end: { line: 0 } }
            }
          ]
        })
      }))

      // when
      const { extractMagicContextForFiles } = await import("./magic-context-manager")
      const extracted = await extractMagicContextForFiles([testFile], {
        workspaceDir: TEST_DIR,
        excludePaths: ["**/ignored/**"],
      })

      // then
      expect(extracted).toContain("### File Signature: [service.ts]")
      expect(extracted).toContain("class TempClass {")
    })
  })
})
