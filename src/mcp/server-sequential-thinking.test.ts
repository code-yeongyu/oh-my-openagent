import { describe, expect, test } from "bun:test"
import { createServerSequentialThinkingConfig } from "./server-sequential-thinking"
import type { RuntimeExecutableResolver } from "./runtime-executable"

const npxAvailable: RuntimeExecutableResolver = (name) => ({
  command: name === "npx" ? "/usr/local/bin/npx" : name,
  available: name === "npx",
})

const npxMissing: RuntimeExecutableResolver = (name) => ({
  command: name,
  available: false,
})

describe("createServerSequentialThinkingConfig", () => {
  test("returns a LocalMcpConfig that launches the official server-sequential-thinking package", () => {
    const config = createServerSequentialThinkingConfig({ resolveExecutable: npxAvailable })
    expect(config.type).toBe("local")
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([
      "/usr/local/bin/npx",
      "-y",
      "@modelcontextprotocol/server-sequential-thinking",
    ])
  })

  test("disables itself when npx is not on PATH (instead of failing at runtime)", () => {
    const config = createServerSequentialThinkingConfig({ resolveExecutable: npxMissing })
    expect(config.enabled).toBe(false)
    // The command is still recorded so we can show the user what would have
    // run; only `enabled: false` should keep opencode from launching it.
    expect(config.command[0]).toBe("npx")
    expect(config.command[2]).toBe("@modelcontextprotocol/server-sequential-thinking")
  })

  test("does not set any environment variables (server is stateless)", () => {
    const config = createServerSequentialThinkingConfig({ resolveExecutable: npxAvailable })
    expect(config.environment).toBeUndefined()
  })

  test("falls back to resolveRuntimeExecutable when no resolver is injected", () => {
    // The default code path must still hand back a config object (the boolean
    // value of `enabled` depends on whether npx is on this machine's PATH,
    // which we deliberately do not assert on).
    const config = createServerSequentialThinkingConfig()
    expect(config.type).toBe("local")
    expect(config.command[2]).toBe("@modelcontextprotocol/server-sequential-thinking")
  })
})
