import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { McpPersistencePoller } from "./poller"
import type { McpStateFetcherClient } from "./state-fetcher"

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "idm-mcp-poller-"))
}

function mockClient(runtime: Record<string, "connected" | "disabled">): McpStateFetcherClient {
  return {
    mcp: {
      status: async () => {
        const out: Record<string, { status: string }> = {}
        for (const [k, v] of Object.entries(runtime)) out[k] = { status: v }
        return out
      },
    },
  }
}

describe("McpPersistencePoller.tickOnce", () => {
  describe("#given runtime says github disabled and no persisted opencode.json", () => {
    test("#when tickOnce runs #then writes enabled:false to opencode.json", async () => {
      const dir = freshDir()
      const poller = new McpPersistencePoller({
        client: mockClient({ github: "disabled" }),
        directory: dir,
      })
      const r = await poller.tickOnce()
      expect(r.changes).toBe(1)
      expect(r.written).toBe(true)
      const parsed = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"))
      expect(parsed.mcp.github.enabled).toBe(false)
    })
  })

  describe("#given runtime and persisted agree", () => {
    test("#when tickOnce runs #then no change and no write", async () => {
      const dir = freshDir()
      writeFileSync(
        join(dir, "opencode.json"),
        JSON.stringify({ mcp: { github: { enabled: false } } }),
      )
      const poller = new McpPersistencePoller({
        client: mockClient({ github: "disabled" }),
        directory: dir,
      })
      const r = await poller.tickOnce()
      expect(r.changes).toBe(0)
      expect(r.written).toBe(false)
    })
  })

  describe("#given user re-enables MCP previously disabled in project config", () => {
    test("#when tickOnce runs #then flips enabled to true", async () => {
      const dir = freshDir()
      writeFileSync(
        join(dir, "opencode.json"),
        JSON.stringify({ mcp: { github: { enabled: false } } }),
      )
      const poller = new McpPersistencePoller({
        client: mockClient({ github: "connected" }),
        directory: dir,
      })
      const r = await poller.tickOnce()
      expect(r.written).toBe(true)
      const parsed = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"))
      expect(parsed.mcp.github.enabled).toBe(true)
    })
  })

  describe("#given client.mcp.status throws", () => {
    test("#when tickOnce runs #then error propagates (caller catches)", async () => {
      const dir = freshDir()
      const poller = new McpPersistencePoller({
        client: {
          mcp: {
            status: async () => {
              throw new Error("connection refused")
            },
          },
        },
        directory: dir,
      })
      await expect(poller.tickOnce()).rejects.toThrow("connection refused")
      expect(existsSync(join(dir, "opencode.json"))).toBe(false)
    })
  })
})

describe("McpPersistencePoller lifecycle", () => {
  describe("#given a started poller", () => {
    test("#when start is called twice #then second call is a no-op", () => {
      const poller = new McpPersistencePoller({
        client: mockClient({}),
        directory: freshDir(),
        intervalMs: 60_000,
      })
      poller.start()
      poller.start()
      poller.stop()
    })
  })

  describe("#given a never-started poller", () => {
    test("#when stop is called #then it is a no-op", () => {
      const poller = new McpPersistencePoller({
        client: mockClient({}),
        directory: freshDir(),
      })
      poller.stop()
    })
  })
})
