import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createServerMemoryConfig } from "./server-memory"
import type { RuntimeExecutableResolver } from "./runtime-executable"

const npxAvailable: RuntimeExecutableResolver = (name) => ({
  command: name === "npx" ? "/usr/local/bin/npx" : name,
  available: name === "npx",
})
const npxMissing: RuntimeExecutableResolver = (name) => ({
  command: name,
  available: false,
})

describe("createServerMemoryConfig", () => {
  const originalEnv = {
    OMO_MEMORY_FILE_PATH: process.env["OMO_MEMORY_FILE_PATH"],
    XDG_CACHE_HOME: process.env["XDG_CACHE_HOME"],
  }
  const tempDirs: string[] = []

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
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("returns a LocalMcpConfig that launches the official server-memory package", () => {
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.type).toBe("local")
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual(["/usr/local/bin/npx", "-y", "@modelcontextprotocol/server-memory"])
  })

  test("uses ~/.cache/opencode/oh-my-openagent-memory.json by default", () => {
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.environment?.MEMORY_FILE_PATH).toBe(
      join(homedir(), ".cache", "opencode", "oh-my-openagent-memory.json"),
    )
  })

  test("respects XDG_CACHE_HOME when set", () => {
    const tmp = mkdtempSync(join(tmpdir(), "omo-mem-xdg-"))
    tempDirs.push(tmp)
    process.env["XDG_CACHE_HOME"] = tmp
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.environment?.MEMORY_FILE_PATH).toBe(
      join(tmp, "opencode", "oh-my-openagent-memory.json"),
    )
  })

  test("OMO_MEMORY_FILE_PATH overrides the default location entirely", () => {
    const tmp = mkdtempSync(join(tmpdir(), "omo-mem-env-"))
    tempDirs.push(tmp)
    process.env["OMO_MEMORY_FILE_PATH"] = join(tmp, "memory.json")
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.environment?.MEMORY_FILE_PATH).toBe(join(tmp, "memory.json"))
  })

  test("OMO_MEMORY_FILE_PATH wins over XDG_CACHE_HOME", () => {
    const tmpEnv = mkdtempSync(join(tmpdir(), "omo-mem-env-precedence-"))
    const tmpXdg = mkdtempSync(join(tmpdir(), "omo-mem-xdg-precedence-"))
    tempDirs.push(tmpEnv, tmpXdg)
    process.env["OMO_MEMORY_FILE_PATH"] = join(tmpEnv, "memory.json")
    process.env["XDG_CACHE_HOME"] = tmpXdg
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.environment?.MEMORY_FILE_PATH).toBe(join(tmpEnv, "memory.json"))
  })

  // hardening from cubic-dev-ai review on #4286 ↓

  test("disables itself when npx is not on PATH (instead of failing at runtime)", () => {
    const config = createServerMemoryConfig({ resolveExecutable: npxMissing })
    expect(config.enabled).toBe(false)
    expect(config.command[0]).toBe("npx")
  })

  test("ignores OMO_MEMORY_FILE_PATH set to an empty / whitespace string", () => {
    process.env["OMO_MEMORY_FILE_PATH"] = "   "
    const config = createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(config.environment?.MEMORY_FILE_PATH).toBe(
      join(homedir(), ".cache", "opencode", "oh-my-openagent-memory.json"),
    )
  })

  test("creates the parent directory of the memory file so the first write does not ENOENT", () => {
    const tmp = mkdtempSync(join(tmpdir(), "omo-mem-mkdir-"))
    tempDirs.push(tmp)
    const filePath = join(tmp, "nested", "deeper", "memory.json")
    process.env["OMO_MEMORY_FILE_PATH"] = filePath

    expect(existsSync(dirname(filePath))).toBe(false)
    createServerMemoryConfig({ resolveExecutable: npxAvailable })
    expect(existsSync(dirname(filePath))).toBe(true)
  })
})
