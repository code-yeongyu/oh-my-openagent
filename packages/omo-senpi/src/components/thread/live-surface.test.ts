import { describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { join, resolve } from "node:path"
import { TASK_HOST_SOCKET_ENV_NAMES } from "../../../../senpi-task/src/runners/rpc-host/daemon"
import { createLiveThreadSurface, resolveThreadSocket, THREAD_SOCKET_ENV_NAMES } from "./live-surface"
import type { ThreadHost } from "./tools"

/**
 * `preamble` frames are written BEFORE the correlated response, exactly as the multi-session host
 * does: an `open_session` admission notice (`{type:"queued", for_request:<id>}`) and connection-wide
 * broadcasts (`agent_start`, `session_opened`) can all land on the wire ahead of the reply.
 */
async function withRpc(
  response: Record<string, unknown> | ((frame: Record<string, unknown>) => Record<string, unknown>),
  exercise: (surface: ThreadHost, frames: Array<Record<string, unknown>>) => Promise<void>,
  preamble: (requestId: string) => Array<Record<string, unknown>> = () => [],
): Promise<void> {
  const directory = mkdtempSync("/tmp/thread-rpc-")
  const socketPath = join(directory, "rpc.sock")
  const frames: Array<Record<string, unknown>> = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const frame = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
      buffer = buffer.slice(newline + 1)
      frames.push(frame)
      const answer = typeof response === "function" ? response(frame) : response
      const lines = [...preamble(String(frame.id)), { id: frame.id, type: "response", command: frame.type, ...answer }]
      socket.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""))
    })
  })
  try {
    const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
    server.listen(socketPath)
    await listening
    await exercise(createLiveThreadSurface({} as never, { env: { SENPI_RPC_SOCKET: socketPath } }), frames)
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    for (const socket of sockets) socket.destroy()
    server.close()
    await closed
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("live thread socket discovery", () => {
  test("#given the thread surface and the task daemon #when the socket names are compared #then both read the ONE shared list", () => {
    // given / when / then
    expect(THREAD_SOCKET_ENV_NAMES).toBe(TASK_HOST_SOCKET_ENV_NAMES)
  })
  test("operator override wins", () => {
    expect(resolveThreadSocket({ SENPI_RPC_SOCKET: "/tmp/override.sock" })).toBe("/tmp/override.sock")
  })
  test("#given the desktop's OMO_RPC_SOCKET_PATH #when no engine RPC_SOCKET is set #then the desktop host socket is used", () => {
    expect(resolveThreadSocket({ OMO_RPC_SOCKET_PATH: "/h/.omo/agent/rpc-desktop/rpc.sock", OMO_CODING_AGENT_DIR: "/h/.omo/agent" })).toBe("/h/.omo/agent/rpc-desktop/rpc.sock")
  })
  test("#given brand and legacy RPC_SOCKET names #when several are set #then the brand name wins and blanks are skipped", () => {
    expect(resolveThreadSocket({ OMO_RPC_SOCKET: "/brand.sock", SENPI_RPC_SOCKET: "/legacy.sock", OMO_RPC_SOCKET_PATH: "/desktop.sock" })).toBe("/brand.sock")
    expect(resolveThreadSocket({ OMO_RPC_SOCKET: "  ", PI_RPC_SOCKET: "/pi.sock", OMO_RPC_SOCKET_PATH: "/desktop.sock" })).toBe("/pi.sock")
    expect(resolveThreadSocket({ OMO_CODING_AGENT_DIR: "/configured" })).toBe(join(resolve("/configured"), "rpc", "rpc.sock"))
  })
  test("canonical and env branches resolve through resolveAgentHome", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    const canonical = join("/h", ".omo", "agent")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === join(canonical, "settings.json") })).toBe(canonical)
    expect(resolveAgentHome({ env: { OMO_CODING_AGENT_DIR: "/configured" }, homeDir: "/h", exists: () => false })).toBe(resolve("/configured"))
  })
  test("resolveAgentHome supports flat and standalone fallback", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    const flat = join("/h", ".omo")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === join(flat, "settings.json") })).toBe(flat)
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: () => false })).toBe(join("/h", ".senpi", "agent"))
  })
  test("always constructs a surface when the socket is absent at registration", () => {
    expect(createLiveThreadSurface({} as never, { env: { SENPI_RPC_SOCKET: "/missing.sock" }, exists: () => false })).toBeDefined()
  })
  test("returns typed host_unavailable when the socket is absent at call time", async () => {
    const surface = createLiveThreadSurface({} as never, { env: { SENPI_RPC_SOCKET: "/missing.sock" }, exists: () => false })
    await expect(surface.listSessions()).rejects.toThrow("host_unavailable:/missing.sock")
  })
})

describe("live thread session-control RPCs", () => {
  test("setSessionName writes set_session_name and accepts a success frame without data", async () => {
    await withRpc({ success: true }, async (surface, frames) => {
      expect(typeof surface.setSessionName).toBe("function")
      expect(await surface.setSessionName("route-peer", "New Name")).toBeUndefined()
      expect(frames).toEqual([{ id: expect.any(String), type: "set_session_name", sessionId: "route-peer", name: "New Name" }])
    })
  })

  test("setModel writes provider and modelId and reads the full model response", async () => {
    await withRpc({ success: true, data: { provider: "openai", id: "gpt-x", name: "GPT X", contextWindow: 1234 } }, async (surface, frames) => {
      expect(typeof surface.setModel).toBe("function")
      expect(await surface.setModel("route-peer", "openai", "gpt-x")).toMatchObject({ provider: "openai", id: "gpt-x", name: "GPT X" })
      expect(frames).toEqual([{ id: expect.any(String), type: "set_model", sessionId: "route-peer", provider: "openai", modelId: "gpt-x" }])
    })
  })

  test("getAvailableModels writes get_available_models and projects the catalog", async () => {
    await withRpc({ success: true, data: { models: [{ provider: "openai", id: "gpt-x", name: "GPT X", contextWindow: 1234 }, { provider: "other", id: "other-model", contextWindow: 4321 }] } }, async (surface, frames) => {
      expect(typeof surface.getAvailableModels).toBe("function")
      expect(await surface.getAvailableModels("route-peer")).toEqual([{ provider: "openai", id: "gpt-x", name: "GPT X" }, { provider: "other", id: "other-model" }])
      expect(frames).toEqual([{ id: expect.any(String), type: "get_available_models", sessionId: "route-peer" }])
    })
  })

  test.each([undefined, "session", "turn"] as const)("setThinkingLevel writes only wire-supported scope for %s", async (scope) => {
    await withRpc({ success: true }, async (surface, frames) => {
      expect(typeof surface.setThinkingLevel).toBe("function")
      expect(await surface.setThinkingLevel("route-peer", "high", scope)).toBeUndefined()
      expect(frames).toEqual([{ id: expect.any(String), type: "set_thinking_level", sessionId: "route-peer", level: "high", ...(scope === "turn" ? { scope: "turn" } : {}) }])
    })
  })

  test("getAvailableThinkingLevels writes get_available_thinking_levels and unwraps levels", async () => {
    await withRpc({ success: true, data: { levels: ["off", "high"] } }, async (surface, frames) => {
      expect(typeof surface.getAvailableThinkingLevels).toBe("function")
      expect(await surface.getAvailableThinkingLevels("route-peer")).toEqual(["off", "high"])
      expect(frames).toEqual([{ id: expect.any(String), type: "get_available_thinking_levels", sessionId: "route-peer" }])
    })
  })

  test("set_thinking_level unsupported failure frames become classified errors", async () => {
    await withRpc({ success: false, error: "Thinking level low is not supported by the active model." }, async (surface, frames) => {
      expect(typeof surface.setThinkingLevel).toBe("function")
      await expect(surface.setThinkingLevel("route-peer", "low")).rejects.toThrow(/^thinking_level_unsupported:/)
      expect(frames).toEqual([{ id: expect.any(String), type: "set_thinking_level", sessionId: "route-peer", level: "low" }])
    })
  })

  test("unrelated set_thinking_level failures are not mislabeled as unsupported", async () => {
    await withRpc({ success: false, error: "Session not found" }, async (surface) => {
      expect(typeof surface.setThinkingLevel).toBe("function")
      await expect(surface.setThinkingLevel("route-peer", "low")).rejects.toThrow(/^thread RPC request failed:/)
    })
  })
})

describe("live thread request correlation", () => {
  test("#given an open_session admission notice ahead of the reply #when openSession runs #then the queued frame is skipped and the correlated response is returned", async () => {
    await withRpc(
      (frame) =>
        frame.type === "open_session"
          ? { success: true, data: { sessionId: "route-new", state: { cwd: "/w" } } }
          : frame.type === "set_session_name"
            ? { success: true }
            : { success: true, data: { sessions: [{ sessionId: "route-new", durableSessionId: "01a0-queued", cwd: "/w", name: "peer", status: "open" }] } },
      async (surface) => {
        const opened = await surface.openSession({ cwd: "/w", name: "peer" })
        expect(opened.sessionId).toBe("route-new")
        expect(opened.durableSessionId).toBe("01a0-queued")
      },
      // Every one of the three calls is preceded by the admission notice, so the skip has to hold
      // on each connection, not just the first.
      (requestId) => [{ type: "queued", for_request: requestId, position: 1, in_flight: 0 }],
    )
  })

  test("#given connection-wide broadcasts ahead of the reply #when listSessions runs #then only the frame carrying the request id settles it", async () => {
    await withRpc(
      { success: true, data: { sessions: [{ sessionId: "route-a", cwd: "/w" }] } },
      async (surface) => {
        const sessions = await surface.listSessions()
        expect(sessions).toEqual([{ sessionId: "route-a", cwd: "/w" }])
      },
      () => [
        { type: "agent_start", sessionId: "route-other" },
        { id: "some-other-request", type: "response", command: "get_state", success: true, data: {} },
        { type: "session_opened", sessionId: "route-other" },
      ],
    )
  })

  test("#given an open_session reply carrying only the routing id #when openSession runs #then the durable id from the session list is returned as the address", async () => {
    await withRpc(
      (frame) =>
        frame.type === "open_session"
          ? { success: true, data: { sessionId: "rpc-1", state: { cwd: "/w" } } }
          : { success: true, data: { sessions: [{ sessionId: "rpc-1", durableSessionId: "01a0-durable", cwd: "/w", status: "open" }] } },
      async (surface, frames) => {
        const opened = await surface.openSession({ cwd: "/w" })
        // The address book keys every entry by the durable id, so an address that is only the
        // routing id resolves to not_found on the very next call.
        expect(opened.durableSessionId).toBe("01a0-durable")
        expect(opened.sessionId).toBe("rpc-1")
        expect(frames.map((f) => f.type)).toEqual(["open_session", "list_sessions"])
        // This client is one-shot: the connection that opens a session drops immediately. Without
        // retain_on_disconnect the host closes that session at once and every later call is
        // session_closing, so a created thread would never be usable.
        expect(frames[0]).toMatchObject({ type: "open_session", retain_on_disconnect: true })
      },
    )
  })

  test("#given a requested name #when openSession runs #then the name is applied through set_session_name and echoed back", async () => {
    await withRpc(
      (frame) =>
        frame.type === "open_session"
          ? { success: true, data: { sessionId: "rpc-2", state: { cwd: "/w" } } }
          : frame.type === "set_session_name"
            ? { success: true }
            : { success: true, data: { sessions: [{ sessionId: "rpc-2", durableSessionId: "01a0-named", cwd: "/w", name: "peer-one", status: "open" }] } },
      async (surface, frames) => {
        const opened = await surface.openSession({ cwd: "/w", name: "peer-one" })
        expect(opened.name).toBe("peer-one")
        expect(opened.durableSessionId).toBe("01a0-named")
        expect(frames.map((f) => f.type)).toEqual(["open_session", "set_session_name", "list_sessions"])
        expect(frames[1]).toMatchObject({ sessionId: "rpc-2", name: "peer-one" })
      },
    )
  })

  test("#given a failure response for a different request id #when a request is pending #then it is ignored rather than settling the pending call", async () => {
    await withRpc(
      { success: true, data: {} },
      async (surface) => {
        await expect(surface.setSessionName("route-peer", "renamed")).resolves.toBeUndefined()
      },
      () => [{ id: "stale-request", type: "response", command: "set_session_name", success: false, error: "Session not found" }],
    )
  })
})
