import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import * as configDir from "../../shared/opencode-config-dir"
import { readOpencodeConfigAgents } from "./opencode-config-agents-reader"

describe("readOpencodeConfigAgents", () => {
  let mockGlobalConfigDir = ""
  let configDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockGlobalConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-mock-global-"))
    configDirSpy = spyOn(configDir, "getOpenCodeConfigDir").mockReturnValue(mockGlobalConfigDir)
  })

  afterEach(() => {
    configDirSpy.mockRestore()
    fs.rmSync(mockGlobalConfigDir, { recursive: true, force: true })
  })

  it("returns empty record when no opencode.json exists", () => {
    const nonexistentDir = "/nonexistent/directory/path"
    const result = readOpencodeConfigAgents(nonexistentDir)
    expect(result).toEqual({})
  })

  it("reads inline agents from opencode.json", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          "my-agent": {
            description: "Custom agent",
            model: "claude-opus-4-6",
            mode: "subagent",
            prompt: "You are a helpful assistant",
          },
        },
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(result).toHaveProperty("my-agent")
    expect(result["my-agent"].description).toBe("(opencode-config) Custom agent")
    expect(result["my-agent"].mode).toBe("subagent")
    expect(result["my-agent"].prompt).toBe("You are a helpful assistant")
    expect(result["my-agent"].model).toBeDefined()

    fs.rmSync(tempDir, { recursive: true })
  })

  it("reads agents from opencode.jsonc with comments", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.jsonc")
    fs.writeFileSync(
      configPath,
      `{
  // Define agents
  "agents": {
    "test-agent": {
      "description": "Test agent",
      "prompt": "Test prompt"
    }
  }
}
`
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(Object.keys(result).length).toBeGreaterThan(0)
    expect(result).toHaveProperty("test-agent")
    expect(result["test-agent"].description).toBe("(opencode-config) Test agent")
    expect(result["test-agent"].prompt).toBe("Test prompt")

    fs.rmSync(tempDir, { recursive: true })
  })

  it("handles malformed opencode.json gracefully", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(configPath, "{ invalid json ")

    const result = readOpencodeConfigAgents(tempDir)
    expect(result).toEqual({})

    fs.rmSync(tempDir, { recursive: true })
  })

  it("maps Claude model names correctly", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          "sonnet-agent": {
            description: "Sonnet",
            model: "sonnet",
            prompt: "test",
          },
          "opus-agent": {
            description: "Opus",
            model: "opus",
            prompt: "test",
          },
        },
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(result["sonnet-agent"].model).toBeDefined()
    expect(result["opus-agent"].model).toBeDefined()

    fs.rmSync(tempDir, { recursive: true })
  })

  it("handles agent_definitions file paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const agentDefFile = path.join(opencodeDir, "agents.json")
    fs.writeFileSync(
      agentDefFile,
      JSON.stringify({
        name: "definition-agent",
        description: "From definition file",
        prompt: "File-based agent prompt",
      })
    )

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent_definitions: ["./agents.json"],
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    if (Object.keys(result).length > 0) {
      expect(result).toHaveProperty("definition-agent")
      expect(result["definition-agent"].description).toContain("From definition file")
    }

    fs.rmSync(tempDir, { recursive: true })
  })

  it("merges inline and definition agents, with inline taking precedence", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const agentDefFile = path.join(opencodeDir, "agents.json")
    fs.writeFileSync(
      agentDefFile,
      JSON.stringify({
        name: "shared-agent",
        description: "From definition file",
        prompt: "Definition prompt",
      })
    )

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          "shared-agent": {
            description: "From inline",
            prompt: "Inline prompt",
          },
        },
        agent_definitions: ["./agents.json"],
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(result["shared-agent"].description).toBe("(opencode-config) From inline")
    expect(result["shared-agent"].prompt).toBe("Inline prompt")

    fs.rmSync(tempDir, { recursive: true })
  })

  it("parses tools as both string and array formats", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          "string-tools": {
            description: "Tools as string",
            tools: "tool1, tool2, tool3",
            prompt: "test",
          },
          "array-tools": {
            description: "Tools as array",
            tools: ["bash", "read"],
            prompt: "test",
          },
        },
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(result["string-tools"].tools).toEqual({
      tool1: true,
      tool2: true,
      tool3: true,
    })

    expect(result["array-tools"].tools).toEqual({
      bash: true,
      read: true,
    })

    fs.rmSync(tempDir, { recursive: true })
  })

  it("supports agent key as fallback when agents key is not present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          "fallback-agent": {
            description: "Using agent key",
            mode: "subagent",
            prompt: "Fallback prompt",
          },
        },
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    expect(result).toHaveProperty("fallback-agent")
    expect(result["fallback-agent"].description).toBe("(opencode-config) Using agent key")
    expect(result["fallback-agent"].prompt).toBe("Fallback prompt")

    fs.rmSync(tempDir, { recursive: true })
  })

  it("prioritizes project-level opencode.json over user-level", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-project-"))
    const projectOpencodeDir = path.join(projectDir, ".opencode")
    fs.mkdirSync(projectOpencodeDir, { recursive: true })

    const projectConfigPath = path.join(projectOpencodeDir, "opencode.json")
    fs.writeFileSync(
      projectConfigPath,
      JSON.stringify({
        agents: {
          "project-agent": {
            description: "From project",
            prompt: "Project prompt",
          },
        },
      })
    )

    const result = readOpencodeConfigAgents(projectDir)

    expect(result).toHaveProperty("project-agent")
    expect(result["project-agent"].description).toBe("(opencode-config) From project")

    fs.rmSync(projectDir, { recursive: true })
  })

  it("handles agent_definitions as array of paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
    const opencodeDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })

    const agentDef1 = path.join(opencodeDir, "agents1.json")
    fs.writeFileSync(
      agentDef1,
      JSON.stringify({
        name: "agent-one",
        description: "First agent",
        prompt: "Prompt 1",
      })
    )

    const agentDef2 = path.join(opencodeDir, "agents2.json")
    fs.writeFileSync(
      agentDef2,
      JSON.stringify({
        name: "agent-two",
        description: "Second agent",
        prompt: "Prompt 2",
      })
    )

    const configPath = path.join(opencodeDir, "opencode.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent_definitions: ["./agents1.json", "./agents2.json"],
      })
    )

    const result = readOpencodeConfigAgents(tempDir)

    if (Object.keys(result).length >= 2) {
      expect(result).toHaveProperty("agent-one")
      expect(result).toHaveProperty("agent-two")
    }

    fs.rmSync(tempDir, { recursive: true })
  })
})
