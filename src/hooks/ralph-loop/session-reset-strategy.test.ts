/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createIterationSession, selectSessionInTui } from "./session-reset-strategy"

describe("session-reset-strategy selectSessionInTui", () => {
  const originalFetch = globalThis.fetch
  const originalUsername = process.env.OPENCODE_SERVER_USERNAME
  const originalPassword = process.env.OPENCODE_SERVER_PASSWORD

  const restoreEnv = (key: "OPENCODE_SERVER_USERNAME" | "OPENCODE_SERVER_PASSWORD", value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
      return
    }

    process.env[key] = value
  }

  beforeEach(() => {
    restoreEnv("OPENCODE_SERVER_USERNAME", originalUsername)
    restoreEnv("OPENCODE_SERVER_PASSWORD", originalPassword)
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    restoreEnv("OPENCODE_SERVER_USERNAME", originalUsername)
    restoreEnv("OPENCODE_SERVER_PASSWORD", originalPassword)
    globalThis.fetch = originalFetch
  })

  test("uses SDK TUI selectSession with v2 parameter shape when supported", async () => {
    const calls: unknown[] = []
    const client = {
      tui: {
        selectSession: async (args: unknown) => {
          calls.push(args)
          return {}
        },
      },
    }

    const result = await selectSessionInTui(client as never, "ses_v2")

    expect(result).toBe(true)
    expect(calls).toEqual([{ sessionID: "ses_v2" }])
  })

  test("falls back to legacy body-wrapped SDK shape when v2 call fails", async () => {
    const calls: unknown[] = []
    const client = {
      tui: {
        selectSession: async (args: unknown) => {
          calls.push(args)
          const record = args as { body?: { sessionID?: string }; sessionID?: string }
          if (record.body?.sessionID) {
            return {}
          }
          throw new Error("bad shape")
        },
      },
    }

    const result = await selectSessionInTui(client as never, "ses_v1")

    expect(result).toBe(true)
    expect(calls).toEqual([
      { sessionID: "ses_v1" },
      { body: { sessionID: "ses_v1" } },
    ])
  })

  test("falls back to tui.publish session select event when selectSession is unavailable", async () => {
    const publishCalls: unknown[] = []
    const client = {
      tui: {
        publish: async (args: unknown) => {
          publishCalls.push(args)
          return {}
        },
      },
    }

    const result = await selectSessionInTui(client as never, "ses_publish")

    expect(result).toBe(true)
    expect(publishCalls).toEqual([
      {
        body: {
          type: "tui.session.select",
          properties: { sessionID: "ses_publish" },
        },
      },
    ])
  })

  test("falls back to HTTP endpoint when SDK TUI methods are unavailable", async () => {
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
    process.env.OPENCODE_SERVER_PASSWORD = "secret"

    const fetchCalls: Array<{ url: string; body: unknown; method?: string; auth?: string | null }> = []
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: init?.body,
        method: init?.method,
        auth: init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : Array.isArray(init?.headers)
            ? null
            : (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      })
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const client = {
      _client: {
        getConfig: () => ({ baseUrl: "http://127.0.0.1:4096" }),
      },
      tui: {},
    }

    const result = await selectSessionInTui(client as never, "ses_http")

    expect(result).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:4096/tui/select-session")
    expect(fetchCalls[0].method).toBe("POST")
    expect(fetchCalls[0].auth).toContain("Basic ")
    expect(JSON.parse(String(fetchCalls[0].body))).toEqual({ sessionID: "ses_http" })
  })

  test("creates top-level iteration session without parentID", async () => {
    const calls: Array<{ body?: unknown; query?: unknown }> = []
    const ctx = {
      client: {
        session: {
          create: async (args: { body?: unknown; query?: unknown }) => {
            calls.push(args)
            return { data: { id: "ses_new_iteration" } }
          },
        },
      },
    }

    const sessionID = await createIterationSession(
      ctx as never,
      "ses_previous_parent",
      "/tmp/project",
      3,
      50,
    )

    expect(sessionID).toBe("ses_new_iteration")
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ title: "Ralph loop iteration 3/50" })
    expect(calls[0].query).toEqual({ directory: "/tmp/project" })
  })
})
