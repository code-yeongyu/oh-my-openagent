/// <reference types="bun-types" />

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import type { HookHttp } from "./types"

const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
)
const mockLog = mock(() => {})

const originalFetch = globalThis.fetch
const originalEnv = process.env

async function importFreshExecuteHttpHook() {
  const modulePath = `${new URL("./execute-http-hook.ts", import.meta.url).pathname}?t=${Date.now()}-${Math.random()}`
  return import(modulePath)
}

describe("executeHttpHook TLS security", () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockReset()
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    )
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env = { ...originalEnv }
    mockLog.mockReset()
    mockFetch.mockReset()
    mock.restore()
  })

  describe("#given production mode", () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: "production" }
    })

    it("#when hook uses remote http:// URL #then rejects with exit code 1", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook URL must use HTTPS")
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("#when hook uses remote HTTP:// URL #then rejects with exit code 1", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "HTTP://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook URL must use HTTPS")
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("#when hook uses remote http:// URL #then logs warning before rejection", async () => {
      mock.module("../../shared/logger", () => ({
        log: mockLog,
      }))
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(mockLog).toHaveBeenCalledWith("HTTP hook URL uses insecure protocol", {
        url: "http://example.com/hooks",
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("#when hook uses http://localhost #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("#when hook uses http://localhost #then does not log insecure warning", async () => {
      mock.module("../../shared", () => ({
        log: mockLog,
      }))
      mockLog.mockReset()
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockLog).not.toHaveBeenCalled()
    })

    it("#when hook uses http://127.0.0.1 #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://127.0.0.1:8080/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("#when hook uses https:// #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "https://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given non-production mode", () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: "development" }
    })

    it("#when hook uses remote http:// URL #then rejects with exit code 1", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook URL must use HTTPS")
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("#when hook uses http://localhost #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("#when hook uses https:// #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "https://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("#when hook uses plain remote http:// URL #then writes warning log", async () => {
      mock.module("../../shared/logger", () => ({
        log: mockLog,
      }))
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://example.com/hooks" }

      await executeHttpHook(hook, "{}")

      expect(mockLog).toHaveBeenCalledWith("HTTP hook URL uses insecure protocol", {
        url: "http://example.com/hooks",
      })
    })

    it("#when hook uses http://[::1] #then allows execution", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://[::1]:8080/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given NODE_ENV is unset", () => {
    beforeEach(() => {
      process.env = { ...originalEnv }
      delete process.env.NODE_ENV
    })

    it("#when hook uses remote http:// URL #then rejects with exit code 1", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "http://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook URL must use HTTPS")
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe("#given redirect downgrade protection", () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: "production" }
    })

    it("#when hook uses https:// URL #then fetch rejects redirects manually", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("redirect", { status: 302, statusText: "Found" }))
      )
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "https://example.com/hooks" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook returned status 302")
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/hooks",
        expect.objectContaining({
          redirect: "manual",
        })
      )
    })
  })

  describe("#given invalid URL handling is preserved", () => {
    it("#when URL is invalid #then rejects with exit code 1", async () => {
      process.env = { ...originalEnv, NODE_ENV: "production" }
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "not-a-valid-url" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("HTTP hook URL is invalid")
    })

    it("#when URL uses disallowed scheme #then rejects with exit code 1", async () => {
      process.env = { ...originalEnv, NODE_ENV: "production" }
      const { executeHttpHook } = await import("./execute-http-hook")
      const hook: HookHttp = { type: "http", url: "file:///etc/passwd" }

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('HTTP hook URL scheme "file:" is not allowed')
    })
  })
})
