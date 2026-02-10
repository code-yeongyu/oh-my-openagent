import { describe, it, expect } from "bun:test"
import { writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadJsonFile } from "./server-config-loader"

describe("loadJsonFile", () => {
  it("parses JSONC config files with comments correctly", () => {
    // given
    const testData = {
      lsp: {
        typescript: {
          command: ["tsserver"],
          extensions: [".ts", ".tsx"]
        }
      }
    }
    const jsoncContent = `{
  // LSP configuration for TypeScript
  "lsp": {
    "typescript": {
      "command": ["tsserver"],
      "extensions": [".ts", ".tsx"] // TypeScript extensions
    }
  }
}`
    const tempPath = join(tmpdir(), "test-config.jsonc")
    writeFileSync(tempPath, jsoncContent, "utf-8")

    // when
    const result = loadJsonFile<typeof testData>(tempPath)

    // then
    expect(result).toEqual(testData)

    // cleanup
    unlinkSync(tempPath)
  })
})