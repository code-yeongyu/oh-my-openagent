import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import type { HookHttp } from "./types"

const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
)

const originalFetch = globalThis.fetch

describe("executeHttpHook", () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockReset()
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    )
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("#given a basic HTTP hook", () => {
    const hook: HookHttp = {
      type: "http",
      url: "http://localhost:8080/hooks/pre-tool-use",
    }
    const stdinData = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" })

    it("#when executed #then sends POST request with correct body", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, stdinData)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe("http://localhost:8080/hooks/pre-tool-use")
      expect(options.method).toBe("POST")
      expect(options.body).toBe(stdinData)
    })

    it("#when executed #then sets content-type to application/json", async () => {
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, stdinData)

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers["Content-Type"]).toBe("application/json")
    })
  })

  describe("#given an HTTP hook with headers and env var interpolation", () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv, MY_TOKEN: "secret-123", OTHER_VAR: "other-value" }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it("#when allowedEnvVars includes the var #then interpolates env var in headers", async () => {
      const hook: HookHttp = {
        type: "http",
        url: "http://localhost:8080/hooks",
        headers: { Authorization: "Bearer $MY_TOKEN" },
        allowedEnvVars: ["MY_TOKEN"],
      }
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, "{}")

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers["Authorization"]).toBe("Bearer secret-123")
    })

    it("#when env var uses ${VAR} syntax #then interpolates correctly", async () => {
      const hook: HookHttp = {
        type: "http",
        url: "http://localhost:8080/hooks",
        headers: { Authorization: "Bearer ${MY_TOKEN}" },
        allowedEnvVars: ["MY_TOKEN"],
      }
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, "{}")

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers["Authorization"]).toBe("Bearer secret-123")
    })

    it("#when env var not in allowedEnvVars #then replaces with empty string", async () => {
      const hook: HookHttp = {
        type: "http",
        url: "http://localhost:8080/hooks",
        headers: { Authorization: "Bearer $OTHER_VAR" },
        allowedEnvVars: ["MY_TOKEN"],
      }
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, "{}")

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers["Authorization"]).toBe("Bearer ")
    })
  })

  describe("#given an HTTP hook with timeout", () => {
    it("#when timeout specified #then passes AbortSignal with timeout", async () => {
      const hook: HookHttp = {
        type: "http",
        url: "http://localhost:8080/hooks",
        timeout: 10,
      }
      const { executeHttpHook } = await import("./execute-http-hook")

      await executeHttpHook(hook, "{}")

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(options.signal).toBeDefined()
    })
  })

  describe("#given a successful HTTP response", () => {
    it("#when response has JSON body #then returns parsed output", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ decision: "allow", reason: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }
      const { executeHttpHook } = await import("./execute-http-hook")

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"decision":"allow"')
    })
  })

  describe("#given a failing HTTP response", () => {
    it("#when response status is 4xx #then returns exit code 1", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Bad Request", { status: 400 }))
      )
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }
      const { executeHttpHook } = await import("./execute-http-hook")

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("400")
    })

    it("#when fetch throws network error #then returns exit code 1", async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")))
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }
      const { executeHttpHook } = await import("./execute-http-hook")

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("ECONNREFUSED")
    })
  })

  describe("#given response with exit code in JSON", () => {
    it("#when JSON contains exitCode 2 #then uses that exit code", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ exitCode: 2, stderr: "blocked" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
      const hook: HookHttp = { type: "http", url: "http://localhost:8080/hooks" }
      const { executeHttpHook } = await import("./execute-http-hook")

      const result = await executeHttpHook(hook, "{}")

      expect(result.exitCode).toBe(2)
    })
  })
})

describe("interpolateEnvVars", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, TOKEN: "abc", SECRET: "xyz" }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("#given $VAR syntax #when var is allowed #then interpolates", async () => {
    const { interpolateEnvVars } = await import("./execute-http-hook")

    const result = interpolateEnvVars("Bearer $TOKEN", ["TOKEN"])

    expect(result).toBe("Bearer abc")
  })

  it("#given ${VAR} syntax #when var is allowed #then interpolates", async () => {
    const { interpolateEnvVars } = await import("./execute-http-hook")

    const result = interpolateEnvVars("Bearer ${TOKEN}", ["TOKEN"])

    expect(result).toBe("Bearer abc")
  })

  it("#given multiple vars #when some not allowed #then only interpolates allowed ones", async () => {
    const { interpolateEnvVars } = await import("./execute-http-hook")

    const result = interpolateEnvVars("$TOKEN:$SECRET", ["TOKEN"])

    expect(result).toBe("abc:")
  })

  it("#given no allowedEnvVars #when called #then replaces all with empty", async () => {
    const { interpolateEnvVars } = await import("./execute-http-hook")

    const result = interpolateEnvVars("Bearer $TOKEN", [])

    expect(result).toBe("Bearer ")
  })
})
