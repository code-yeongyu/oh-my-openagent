import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { createServerMemoryConfig } from "./server-memory"

describe("createServerMemoryConfig", () => {
  const originalEnv = {
    OMO_MEMORY_FILE_PATH: process.env["OMO_MEMORY_FILE_PATH"],
    XDG_CACHE_HOME: process.env["XDG_CACHE_HOME"],
  }

  beforeEach(() => {
    delete process.env["OMO_MEMORY_FILE_PATH"]
    delete process.env["XDG_CACHE_HOME"]
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test("returns a LocalMcpConfig that launches the official server-memory package", () => {
    const config = createServerMemoryConfig()
    expect(config.type).toBe("local")
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"])
  })

  test("uses ~/.cache/opencode/oh-my-openagent-memory.json by default", () => {
    const config = createServerMemoryConfig()
    expect(config.environment?.MEMORY_FILE_PATH).toBe(
      join(homedir(), ".cache", "opencode", "oh-my-openagent-memory.json"),
    )
  })

  test("respects XDG_CACHE_HOME when set", () => {
    process.env["XDG_CACHE_HOME"] = "/tmp/cache"
    const config = createServerMemoryConfig()
    expect(config.environment?.MEMORY_FILE_PATH).toBe(
      "/tmp/cache/opencode/oh-my-openagent-memory.json",
    )
  })

  test("OMO_MEMORY_FILE_PATH overrides the default location entirely", () => {
    process.env["OMO_MEMORY_FILE_PATH"] = "/custom/path/memory.json"
    const config = createServerMemoryConfig()
    expect(config.environment?.MEMORY_FILE_PATH).toBe("/custom/path/memory.json")
  })

  test("OMO_MEMORY_FILE_PATH wins over XDG_CACHE_HOME", () => {
    process.env["OMO_MEMORY_FILE_PATH"] = "/custom/memory.json"
    process.env["XDG_CACHE_HOME"] = "/tmp/cache"
    const config = createServerMemoryConfig()
    expect(config.environment?.MEMORY_FILE_PATH).toBe("/custom/memory.json")
  })
})
