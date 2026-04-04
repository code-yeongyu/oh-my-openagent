/// <reference types="bun-types" />

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import type { HookHttp } from "./types"
import * as sharedLogger from "../../shared/logger"

const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
)
const originalFetch = globalThis.fetch
const originalEnv = process.env

async function importFreshExecuteHttpHook() {
  const modulePath = `${new URL("./execute-http-hook.ts", import.meta.url).pathname}?t=${Date.now()}-${Math.random()}`
  return import(modulePath)
}

describe("executeHttpHook TLS security", () => {
  let logSpy: ReturnType<typeof spyOn> | undefined

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
    logSpy?.mockRestore()
    logSpy = undefined
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
      // given
      logSpy = spyOn(sharedLogger, "log").mockImplementation(() => {})
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://tls-security-remote.invalid/hooks" }

      // when
      const result = await executeHttpHook(hook, "{}")

      // then
      const matchingCalls = logSpy.mock.calls.filter(([message, data]) => {
        return message === "HTTP hook URL uses insecure protocol"
          && JSON.stringify(data) === JSON.stringify({ url: hook.url })
      })

      expect(result.exitCode).toBe(1)
      expect(matchingCalls).toHaveLength(1)
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
      // given
      logSpy = spyOn(sharedLogger, "log").mockImplementation(() => {})
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://localhost:49123/hooks" }

      // when
      const result = await executeHttpHook(hook, "{}")

      // then
      const matchingCalls = logSpy.mock.calls.filter(([message, data]) => {
        return message === "HTTP hook URL uses insecure protocol"
          && JSON.stringify(data) === JSON.stringify({ url: hook.url })
      })

      expect(result.exitCode).toBe(0)
      expect(matchingCalls).toHaveLength(0)
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
      // given
      logSpy = spyOn(sharedLogger, "log").mockImplementation(() => {})
      const { executeHttpHook } = await importFreshExecuteHttpHook()
      const hook: HookHttp = { type: "http", url: "http://tls-security-dev.invalid/hooks" }

      // when
      await executeHttpHook(hook, "{}")

      // then
      const matchingCalls = logSpy.mock.calls.filter(([message, data]) => {
        return message === "HTTP hook URL uses insecure protocol"
          && JSON.stringify(data) === JSON.stringify({ url: hook.url })
      })

      expect(matchingCalls).toHaveLength(1)
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
