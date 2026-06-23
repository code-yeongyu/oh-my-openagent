import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyMcpStateChanges,
  getConfigPath,
  readPersistedMcpStates,
} from "./config-writer"

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "idm-mcp-persistence-"))
}

describe("readPersistedMcpStates", () => {
  describe("#given no opencode.json in directory", () => {
    test("#when read #then returns empty map", () => {
      const dir = freshDir()
      expect(readPersistedMcpStates({ directory: dir }).size).toBe(0)
    })
  })

  describe("#given opencode.json with mcp entries", () => {
    test("#when read #then returns parsed enabled/disabled states", () => {
      const dir = freshDir()
      writeFileSync(
        getConfigPath({ directory: dir }),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: { github: { enabled: false }, slack: { enabled: true } },
        }),
      )
      const states = readPersistedMcpStates({ directory: dir })
      expect(states.get("github")).toBe("disabled")
      expect(states.get("slack")).toBe("enabled")
    })
  })

  describe("#given opencode.json with corrupt JSON", () => {
    test("#when read #then returns empty map without throwing", () => {
      const dir = freshDir()
      writeFileSync(getConfigPath({ directory: dir }), "{not json")
      expect(readPersistedMcpStates({ directory: dir }).size).toBe(0)
    })
  })
})

describe("applyMcpStateChanges", () => {
  describe("#given no existing opencode.json", () => {
    test("#when applying a disable change #then creates file with the entry", () => {
      const dir = freshDir()
      const r = applyMcpStateChanges({ directory: dir }, [
        { name: "github", to: "disabled" },
      ])
      expect(r.written).toBe(true)
      expect(existsSync(r.path)).toBe(true)
      const parsed = JSON.parse(readFileSync(r.path, "utf8"))
      expect(parsed.mcp.github.enabled).toBe(false)
      expect(parsed.$schema).toBe("https://opencode.ai/config.json")
    })
  })

  describe("#given existing opencode.json with unrelated mcp entries", () => {
    test("#when applying change to a different name #then preserves existing", () => {
      const dir = freshDir()
      writeFileSync(
        getConfigPath({ directory: dir }),
        JSON.stringify({
          $schema: "x",
          mcp: { slack: { enabled: true, custom: "keep" } },
        }),
      )
      const r = applyMcpStateChanges({ directory: dir }, [
        { name: "github", to: "disabled" },
      ])
      expect(r.written).toBe(true)
      const parsed = JSON.parse(readFileSync(r.path, "utf8"))
      expect(parsed.mcp.slack).toEqual({ enabled: true, custom: "keep" })
      expect(parsed.mcp.github.enabled).toBe(false)
    })
  })

  describe("#given enable-back of a previously disabled mcp", () => {
    test("#when applying #then sets enabled=true", () => {
      const dir = freshDir()
      writeFileSync(
        getConfigPath({ directory: dir }),
        JSON.stringify({ mcp: { github: { enabled: false } } }),
      )
      const r = applyMcpStateChanges({ directory: dir }, [
        { name: "github", to: "enabled" },
      ])
      expect(r.written).toBe(true)
      const parsed = JSON.parse(readFileSync(r.path, "utf8"))
      expect(parsed.mcp.github.enabled).toBe(true)
    })
  })

  describe("#given no changes to apply", () => {
    test("#when applying empty array #then does not write", () => {
      const dir = freshDir()
      const r = applyMcpStateChanges({ directory: dir }, [])
      expect(r.written).toBe(false)
    })
  })

  describe("#given enable on an MCP that has no entry yet", () => {
    test("#when applying #then does not write (avoids noisy enabled:true entries)", () => {
      const dir = freshDir()
      const r = applyMcpStateChanges({ directory: dir }, [
        { name: "github", to: "enabled" },
      ])
      expect(r.written).toBe(false)
    })
  })
})
