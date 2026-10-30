import { afterAll, afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"

// Contract (#10738): session_read / session_search / session_info page through OpenCode's message API
// with a limit on every request, never hold a whole session, and a timed-out search stops reading.

const TEST_DIR = join(tmpdir(), `omo-test-session-paging-${randomUUID()}`)

mock.module("./constants", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: join(TEST_DIR, "message"),
  PART_STORAGE: join(TEST_DIR, "part"),
  SESSION_STORAGE: join(TEST_DIR, "session"),
  TODO_DIR: join(TEST_DIR, "todos"),
  TRANSCRIPT_DIR: join(TEST_DIR, "transcripts"),
  SESSION_LIST_DESCRIPTION: "test",
  SESSION_READ_DESCRIPTION: "test",
  SESSION_SEARCH_DESCRIPTION: "test",
  SESSION_INFO_DESCRIPTION: "test",
  SESSION_DELETE_DESCRIPTION: "test",
  TOOL_NAME_PREFIX: "session_",
}))

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => true,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const dir = join(TEST_DIR, "message", sessionID)
    return existsSync(dir) ? dir : null
  },
}))

afterAll(() => {
  mock.restore()
})

const { createSessionManagerTools } = await import("./tools")
const { resetStorageClient } = await import("./storage")

type Request = { sessionID: string; limit?: number; before?: string; signal?: AbortSignal }

type HeaderShape = "response" | "foreign-response" | "none"

// Serves GET /session/:id/message the way OpenCode's MessageV2.page does: `limit` returns the newest
// `limit` messages in ascending order plus an X-Next-Cursor header when older ones remain; no limit
// returns everything.
function createFakeServer(sessions: Record<string, number>, headerShape: HeaderShape = "response") {
  const requests: Request[] = []
  let fetchedMessages = 0
  let largestResponse = 0
  let gate: { onRequest: (request: Request) => Promise<void> } | undefined

  const message = (sessionID: string, index: number) => ({
    info: { id: `msg_${String(index).padStart(6, "0")}`, role: index % 2 === 0 ? "user" : "assistant", time: { created: 1_000 + index } },
    parts: [{ id: `prt_${index}`, type: "text", text: `${sessionID} message ${index}${index === 0 ? " needle-oldest" : ""}` }],
  })

  const client = {
    session: {
      messages: async (input: { path: { id: string }; query?: { limit?: number; before?: string }; signal?: AbortSignal }) => {
        const request: Request = { sessionID: input.path.id, limit: input.query?.limit, before: input.query?.before, signal: input.signal }
        requests.push(request)
        if (gate) await gate.onRequest(request)
        input.signal?.throwIfAborted()
        const total = sessions[input.path.id] ?? 0
        const end = request.before === undefined ? total : Number(request.before)
        const start = request.limit ? Math.max(0, end - request.limit) : 0
        const data = Array.from({ length: end - start }, (_, offset) => message(input.path.id, start + offset))
        fetchedMessages += data.length
        largestResponse = Math.max(largestResponse, data.length)
        const headers = new Headers(request.limit && start > 0 ? { "X-Next-Cursor": String(start) } : {})
        if (headerShape === "none") return { data }
        if (headerShape === "foreign-response") return { data, response: { status: 200, headers } }
        return { data, response: new Response(null, { headers }) }
      },
      todo: async () => ({ data: [] }),
      list: async () => ({ data: [] }),
    },
  }

  return {
    client,
    requests,
    get fetchedMessages() {
      return fetchedMessages
    },
    get largestResponse() {
      return largestResponse
    },
    setGate(next: typeof gate) {
      gate = next
    },
  }
}

// Like fetch, a gated request rejects as soon as its signal aborts.
function blockRequest(server: ReturnType<typeof createFakeServer>, requestNumber: number) {
  let seen = 0
  let releaseRead!: () => void
  const blocked = new Promise<Request>((resolveBlocked) => {
    server.setGate({
      onRequest: (request) => {
        seen++
        if (seen !== requestNumber) return Promise.resolve()
        resolveBlocked(request)
        return new Promise<void>((resolveRead, rejectRead) => {
          releaseRead = resolveRead
          request.signal?.addEventListener("abort", () => rejectRead(request.signal?.reason), { once: true })
        })
      },
    })
  })
  return { blocked, release: () => releaseRead() }
}

function writeFileSession(sessionID: string, count: number): void {
  for (let index = 0; index < count; index++) {
    const messageID = `msg_${String(index).padStart(6, "0")}`
    mkdirSync(join(TEST_DIR, "message", sessionID), { recursive: true })
    writeFileSync(
      join(TEST_DIR, "message", sessionID, `${messageID}.json`),
      JSON.stringify({ id: messageID, role: "user", time: { created: 1_000 + index } }),
    )
    mkdirSync(join(TEST_DIR, "part", messageID), { recursive: true })
    writeFileSync(
      join(TEST_DIR, "part", messageID, "prt_0.json"),
      JSON.stringify({ id: "prt_0", type: "text", text: `file message ${index}${index === 0 ? " needle-oldest" : ""}` }),
    )
  }
}

function createContext(abort: AbortSignal = new AbortController().signal): ToolContext {
  return {
    sessionID: "ses_caller",
    messageID: "msg_caller",
    agent: "test-agent",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort,
    metadata: () => {},
    ask: async () => {},
  }
}

function createTools(server: ReturnType<typeof createFakeServer>, sessionIDs: string[] = []) {
  return createSessionManagerTools({ directory: TEST_DIR, client: server.client } as unknown as PluginInput, {
    getAllSessions: async () => sessionIDs,
  })
}

const SESSION_SIZE = 1_000

describe("session-manager paging (#10738)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    jest.useRealTimers()
    resetStorageClient()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("#given a long session #when session_read asks for the last 2 messages #then only those 2 are fetched, every request carrying a limit", async () => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const { session_read } = createTools(server)

    //#when
    const output = await session_read.execute({ session_id: "ses_big", limit: 2, from_end: true }, createContext())

    //#then
    expect(output).toContain("ses_big message 998")
    expect(output).toContain("ses_big message 999")
    expect(output).not.toContain("ses_big message 997")
    expect(server.requests.every((request) => request.limit !== undefined)).toBe(true)
    expect(server.fetchedMessages).toBeLessThanOrEqual(3)
  })

  test("#given a long session #when session_read asks for the first 2 messages #then it pages from the newest end and no response holds more than one page", async () => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const { session_read } = createTools(server)

    //#when
    const output = await session_read.execute({ session_id: "ses_big", limit: 2 }, createContext())

    //#then
    expect(output).toContain("ses_big message 0 needle-oldest")
    expect(output).toContain("ses_big message 1")
    expect(output).not.toContain("ses_big message 2")
    expect(server.requests.every((request) => request.limit !== undefined)).toBe(true)
    expect(server.largestResponse).toBeLessThan(SESSION_SIZE)
  })

  test("#given a long session #when session_info counts it #then the count is exact while every request carries a limit", async () => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const { session_info } = createTools(server)

    //#when
    const output = await session_info.execute({ session_id: "ses_big" }, createContext())

    //#then
    expect(output).toContain(`Messages: ${SESSION_SIZE}`)
    expect(server.requests.every((request) => request.limit !== undefined)).toBe(true)
    expect(server.largestResponse).toBeLessThan(SESSION_SIZE)
  })

  test("#given a match in the newest messages #when session_search is limited to 1 result #then it stops after the first page", async () => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const { session_search } = createTools(server)

    //#when
    const output = await session_search.execute({ query: "ses_big message 99", session_id: "ses_big", limit: 1 }, createContext())

    //#then
    expect(output).toContain("Found 1 matches")
    expect(server.requests.every((request) => request.limit !== undefined)).toBe(true)
    expect(server.fetchedMessages).toBeLessThan(SESSION_SIZE)
  })

  test("#given a search blocked on a slow read #when its timeout fires #then the in-flight read is aborted and no further reads are made", async () => {
    //#given
    jest.useFakeTimers()
    const server = createFakeServer({ ses_a: SESSION_SIZE, ses_b: SESSION_SIZE, ses_c: SESSION_SIZE })
    const gate = blockRequest(server, 1)
    const { session_search } = createTools(server, ["ses_a", "ses_b", "ses_c"])
    const output = session_search.execute({ query: "zz-no-match" }, createContext())
    const blocked = await Promise.race([
      gate.blocked,
      output.then(() => {
        throw new Error("search settled before its first read was observed")
      }),
    ])

    //#when
    jest.advanceTimersByTime(60_000)
    const result = await output

    //#then
    expect(result).toContain("timed out")
    expect(blocked.signal?.aborted).toBe(true)
    const requestsAtTimeout = server.requests.length
    gate.release()
    jest.useRealTimers()
    await new Promise<void>((drained) => setImmediate(drained))
    expect(server.requests.length).toBe(requestsAtTimeout)
  })

  test.each([
    ["session_info", { session_id: "ses_big" }],
    ["session_read", { session_id: "ses_big", limit: 2 }],
  ] as const)("#given %s walking a long session #when the caller aborts mid-walk #then it returns without the blocked page and reads nothing more", async (toolName: "session_info" | "session_read", args: { session_id: string; limit?: number }) => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const gate = blockRequest(server, 3)
    const caller = new AbortController()
    const tools = createTools(server)
    const output = tools[toolName].execute(args, createContext(caller.signal))
    const blocked = await Promise.race([
      gate.blocked,
      output.then(() => {
        throw new Error(`${toolName} settled before the walk reached its third request`)
      }),
    ])

    //#when
    caller.abort(new Error("cancelled by caller"))
    const result = await output

    //#then
    expect(result).toContain("cancelled by caller")
    expect(blocked.signal?.aborted).toBe(true)
    expect(server.requests.length).toBe(3)
    expect(server.fetchedMessages).toBeLessThanOrEqual(201)
  })

  test.each([
    ["listing", {}],
    ["filtering by date", { from_date: "1970-01-01T00:00:00Z" }],
  ] as const)("#given session_list %s a long session #when the caller aborts mid-count #then it reports the cancellation and reads nothing more", async (_mode: string, args: { from_date?: string }) => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const gate = blockRequest(server, 3)
    const caller = new AbortController()
    const { session_list } = createSessionManagerTools({ directory: TEST_DIR, client: server.client } as unknown as PluginInput, {
      getMainSessions: async () => [{ id: "ses_big", projectID: "p", directory: TEST_DIR, time: { created: 1, updated: 1 } }],
    })
    const output = session_list.execute(args, createContext(caller.signal))
    const blocked = await Promise.race([
      gate.blocked,
      output.then(() => {
        throw new Error("session_list settled before its count reached the third request")
      }),
    ])

    //#when
    caller.abort(new Error("cancelled by caller"))
    const result = String(await output)

    //#then
    expect(result).toContain("cancelled by caller")
    expect(result).not.toContain("Skipped")
    expect(blocked.signal?.aborted).toBe(true)
    expect(server.requests.length).toBe(3)
  })

  test("#given a long session #when session_read asks for the first 150 messages #then the window spans the page boundary exactly", async () => {
    //#given
    const server = createFakeServer({ ses_big: SESSION_SIZE })
    const { session_read } = createTools(server)

    //#when
    const output = await session_read.execute({ session_id: "ses_big", limit: 150 }, createContext())

    //#then
    const indexes = (String(output).match(/ses_big message (\d+)/g) ?? []).map((match: string) => Number(match.split(" ").pop()))
    expect(indexes).toEqual(Array.from({ length: 150 }, (_, index) => index))
  })

  test.each([true, false])("#given a 30-message session #when session_read asks for 50 with from_end=%p #then all 30 come back in order", async (fromEnd: boolean) => {
    //#given
    const server = createFakeServer({ ses_small: 30 })
    const { session_read } = createTools(server)

    //#when
    const output = await session_read.execute({ session_id: "ses_small", limit: 50, from_end: fromEnd }, createContext())

    //#then
    const indexes = (String(output).match(/ses_small message (\d+)/g) ?? []).map((match: string) => Number(match.split(" ").pop()))
    expect(indexes).toEqual(Array.from({ length: 30 }, (_, index) => index))
  })

  test("#given responses whose headers come from another Response implementation #when session_info counts a long session #then it still follows the cursor to the end", async () => {
    //#given
    const server = createFakeServer({ ses_big: 250 }, "foreign-response")
    const { session_info } = createTools(server)

    //#when
    const output = await session_info.execute({ session_id: "ses_big" }, createContext())

    //#then
    expect(output).toContain("Messages: 250")
  })

  test("#given responses with no readable headers #when a full page arrives #then the walk fails loudly instead of truncating", async () => {
    //#given
    const server = createFakeServer({ ses_big: 250, ses_small: 30 }, "none")
    const { session_info } = createTools(server)

    //#when
    const full = await session_info.execute({ session_id: "ses_big" }, createContext())
    const short = await session_info.execute({ session_id: "ses_small" }, createContext())

    //#then
    expect(full).toContain("Error: ")
    expect(full).toContain("Cannot page session ses_big")
    expect(short).toContain("Messages: 30")
  })

  test("#given a session only in file storage #when it is read, counted and searched #then the file pages give the same windows and newest-first order", async () => {
    //#given
    writeFileSession("ses_file", 150)
    const server = createFakeServer({})
    const { session_read, session_info, session_search } = createTools(server)

    //#when
    const last = await session_read.execute({ session_id: "ses_file", limit: 2, from_end: true }, createContext())
    const info = await session_info.execute({ session_id: "ses_file" }, createContext())
    const newest = await session_search.execute({ query: "file message", session_id: "ses_file", limit: 2 }, createContext())
    const oldest = await session_search.execute({ query: "needle-oldest", session_id: "ses_file" }, createContext())

    //#then
    expect(String(last).match(/file message \d+/g)).toEqual(["file message 148", "file message 149"])
    expect(info).toContain("Messages: 150")
    expect(String(newest).match(/msg_\d+/g)).toEqual(["msg_000149", "msg_000148"])
    expect(oldest).toContain("msg_000000")
  })
})
