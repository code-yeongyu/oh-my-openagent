import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { getClaudeConfigDir } from "./claude-config-dir"

describe("getClaudeConfigDir", () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
  })

  test("returns CLAUDE_CONFIG_DIR when env var is set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/claude/path"
    
    const result = getClaudeConfigDir()
    
    expect(result).toBe("/custom/claude/path")
  })

  test("returns ~/.claude when env var is not set", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    
    const result = getClaudeConfigDir()
    
    expect(result).toBe(join(homedir(), ".claude"))
  })

  test("returns ~/.claude when env var is empty string", () => {
    process.env.CLAUDE_CONFIG_DIR = ""
    
    const result = getClaudeConfigDir()
    
    expect(result).toBe(join(homedir(), ".claude"))
  })

  test("handles absolute paths with trailing slash", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/path/"
    
    const result = getClaudeConfigDir()
    
    expect(result).toBe("/custom/path/")
  })

  test("handles relative paths", () => {
    process.env.CLAUDE_CONFIG_DIR = "./my-claude-config"
    
    const result = getClaudeConfigDir()
    
    expect(result).toBe("./my-claude-config")
  })
})
