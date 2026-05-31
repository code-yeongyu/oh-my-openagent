import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { loadAgentDefinitions, parseMarkdownAgentFile } from "./agent-definitions-loader"

describe("agent-definitions-loader", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-definitions-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("#parseMarkdownAgentFile", () => {
    test("parses valid markdown agent file", () => {
      const filePath = join(tempDir, "test-agent.md")
      const content = `---
name: test-agent
description: A test agent
model: claude-opus-4
mode: subagent
tools: bash,read
---

You are a test agent.`

      writeFileSync(filePath, content, "utf-8")

      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("test-agent")
      expect(result?.config.description).toBe("(definition-file) A test agent")
      expect(result?.config.mode).toBe("subagent")
      expect(result?.config.prompt).toBe("You are a test agent.")
      expect(result?.config.tools).toEqual({ bash: true, read: true })
    })

    test("uses filename as agent name if name not specified in frontmatter", () => {
      const filePath = join(tempDir, "custom-name.md")
      const content = `---
description: No name specified
---

Prompt content.`

      writeFileSync(filePath, content, "utf-8")

      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("custom-name")
    })

    test("returns null for missing file", () => {
      const filePath = join(tempDir, "missing.md")
      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).toBeNull()
    })

    test("handles malformed frontmatter gracefully with defaults", () => {
      const filePath = join(tempDir, "malformed.md")
      const content = `---
invalid: yaml: content: here
---

Prompt.`

      writeFileSync(filePath, content, "utf-8")

      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("malformed")
      expect(result?.config.mode).toBe("subagent")
      expect(result?.config.prompt).toBe("Prompt.")
    })

    test("strips .MD extension case-insensitively for agent name", () => {
      const filePath = join(tempDir, "UpperCase.MD")
      const content = `---
description: Mixed case extension
---

Prompt content.`

      writeFileSync(filePath, content, "utf-8")

      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).not.toBeNull()
      expect(result?.name).toBe("UpperCase")
    })

    test("defaults mode to subagent when not specified", () => {
      const filePath = join(tempDir, "no-mode.md")
      const content = `---
name: no-mode-agent
---

Prompt.`

      writeFileSync(filePath, content, "utf-8")

      const result = parseMarkdownAgentFile(filePath, "definition-file")

      expect(result).not.toBeNull()
      expect(result?.config.mode).toBe("subagent")
    })
  })

  describe("#loadAgentDefinitions", () => {
    test("loads mixed format files (markdown and JSON)", () => {
      const mdPath = join(tempDir, "agent1.md")
      const jsonPath = join(tempDir, "agent2.json")

      writeFileSync(
        mdPath,
        `---
name: md-agent
---

Markdown agent prompt.`,
        "utf-8"
      )

      writeFileSync(
        jsonPath,
        JSON.stringify({
          name: "json-agent",
          prompt: "JSON agent prompt.",
        }),
        "utf-8"
      )

      const result = loadAgentDefinitions([mdPath, jsonPath], "definition-file")

      expect(Object.keys(result)).toHaveLength(2)
      expect(result["md-agent"]).toBeDefined()
      expect(result["json-agent"]).toBeDefined()
      expect(result["md-agent"].prompt).toBe("Markdown agent prompt.")
      expect(result["json-agent"].prompt).toBe("JSON agent prompt.")
    })

    test("silently skips missing files with warning log", () => {
      const validPath = join(tempDir, "valid.md")
      const missingPath = join(tempDir, "missing.md")

      writeFileSync(
        validPath,
        `---
name: valid-agent
---

Valid prompt.`,
        "utf-8"
      )

      const result = loadAgentDefinitions([validPath, missingPath], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["valid-agent"]).toBeDefined()
    })

    test("silently skips malformed files with warning log", () => {
      const validPath = join(tempDir, "valid.jsonc")
      const malformedPath = join(tempDir, "malformed.json")

      writeFileSync(
        validPath,
        JSON.stringify({
          name: "valid-agent",
          prompt: "Valid prompt.",
        }),
        "utf-8"
      )

      writeFileSync(malformedPath, "{ invalid json", "utf-8")

      const result = loadAgentDefinitions([validPath, malformedPath], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["valid-agent"]).toBeDefined()
    })

    test("last-write-wins for duplicate agent names", () => {
      const path1 = join(tempDir, "agent-v1.md")
      const path2 = join(tempDir, "agent-v2.md")

      writeFileSync(
        path1,
        `---
name: duplicate-agent
description: First version
---

First prompt.`,
        "utf-8"
      )

      writeFileSync(
        path2,
        `---
name: duplicate-agent
description: Second version
---

Second prompt.`,
        "utf-8"
      )

      const result = loadAgentDefinitions([path1, path2], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["duplicate-agent"].description).toBe("(definition-file) Second version")
      expect(result["duplicate-agent"].prompt).toBe("Second prompt.")
    })

    test("returns empty object for empty paths array", () => {
      const result = loadAgentDefinitions([], "definition-file")

      expect(result).toEqual({})
    })

    test("handles absolute paths correctly", () => {
      const absolutePath = join(tempDir, "absolute.md")

      writeFileSync(
        absolutePath,
        `---
name: absolute-agent
---

Absolute path prompt.`,
        "utf-8"
      )

      const result = loadAgentDefinitions([absolutePath], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["absolute-agent"]).toBeDefined()
    })

    test("skips unsupported file extensions with warning", () => {
      const validPath = join(tempDir, "valid.md")
      const unsupportedPath = join(tempDir, "unsupported.txt")

      writeFileSync(
        validPath,
        `---
name: valid-agent
---

Valid prompt.`,
        "utf-8"
      )

      writeFileSync(unsupportedPath, "Some text file content.", "utf-8")

      const result = loadAgentDefinitions([validPath, unsupportedPath], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["valid-agent"]).toBeDefined()
    })

    test("supports JSONC format with comments", () => {
      const jsoncPath = join(tempDir, "agent.jsonc")

      writeFileSync(
        jsoncPath,
        `{
  // This is a comment
  "name": "jsonc-agent",
  "description": "JSONC agent", // inline comment
  "prompt": "JSONC prompt."
}`,
        "utf-8"
      )

      const result = loadAgentDefinitions([jsoncPath], "definition-file")

      expect(Object.keys(result)).toHaveLength(1)
      expect(result["jsonc-agent"]).toBeDefined()
      expect(result["jsonc-agent"].prompt).toBe("JSONC prompt.")
    })
  })
})
