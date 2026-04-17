import { describe, test, expect, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { parseJsonAgentFile } from "./json-agent-loader"

describe("json-agent-loader", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  function trackDir(dir: string): string {
    dirs.push(dir)
    return dir
  }

  test("parses valid JSON agent file", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, JSON.stringify({
      name: "test-agent",
      description: "A test agent",
      prompt: "You are a test agent.",
      tools: ["Bash", "Read"],
      model: "claude-3-5-sonnet-20241022",
      mode: "subagent",
    }), "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")

    expect(result).not.toBeNull()
    expect(result?.name).toBe("test-agent")
    expect(result?.path).toBe(filePath)
    expect(result?.scope).toBe("definition-file")
    expect(result?.config.description).toBe("(definition-file) A test agent")
    expect(result?.config.prompt).toBe("You are a test agent.")
    expect(result?.config.mode).toBe("subagent")
    expect(result?.config.tools).toEqual({ bash: true, read: true })
  })

  test("parses JSONC with comments", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.jsonc")

    writeFileSync(filePath, `{
  // Agent name
  "name": "commented-agent",
  "description": "Agent with comments",
  "prompt": "Do something.",
  "tools": ["Bash"], // Tools for the agent
  // Model specification
  "model": "claude-3-5-sonnet-20241022"
}`, "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")

    expect(result).not.toBeNull()
    expect(result?.name).toBe("commented-agent")
    expect(result?.config.tools).toEqual({ bash: true })
  })

  test("returns null when required fields are missing (name)", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, JSON.stringify({
      description: "Missing name",
      prompt: "You are an agent.",
    }), "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")
    expect(result).toBeNull()
  })

  test("returns null when required fields are missing (prompt)", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, JSON.stringify({
      name: "missing-prompt",
      description: "Missing prompt",
    }), "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")
    expect(result).toBeNull()
  })

  test("defaults optional fields correctly", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, JSON.stringify({
      name: "minimal-agent",
      prompt: "You are minimal.",
    }), "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")

    expect(result).not.toBeNull()
    expect(result?.config.description).toBe("(definition-file) ")
    expect(result?.config.mode).toBe("subagent")
    expect(result?.config.tools).toBeUndefined()
    expect(result?.config.model).toBeUndefined()
  })

  test("handles tools as string comma-separated list", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, JSON.stringify({
      name: "string-tools-agent",
      prompt: "You are an agent.",
      tools: "Bash, Read, Grep",
    }), "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")

    expect(result?.config.tools).toEqual({ bash: true, read: true, grep: true })
  })

  test("returns null for malformed JSON", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "json-agent-loader-test-")))
    const filePath = join(dir, "agent.json")

    writeFileSync(filePath, `{
  "name": "broken",
  "prompt": "incomplete json`,
      "utf-8")

    const result = parseJsonAgentFile(filePath, "definition-file")
    expect(result).toBeNull()
  })
})
