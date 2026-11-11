import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../src/index.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"
import type { LocalEvent } from "../src/local-api/protocol.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"

// A local API connection whose attach events the test emits itself, through the SDK's connect seam.
function scriptedClient(onCommand: (commandId: string) => void = () => {}) {
  const listeners = new Set<(event: LocalEvent) => void>()
  let close!: () => void
  const closed = new Promise<void>((resolve) => {
    close = resolve
  })
  const world = defaultWorld()
  const client: LocalApiClient = {
    welcome: {
      type: "welcome",
      v: 1,
      service_version: "1.4.0",
      owner: "service",
      server_proof: "p",
      server_nonce: "n",
      capabilities: [],
      state: world.status,
    },
    request: (async (type: string) => {
      if (type === "session.attach") return { attach: "a1" }
      if (type === "session.detach") return {}
      throw new Error(`unexpected request ${type}`)
    }) as LocalApiClient["request"],
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    command: async (_attach, _rpc, commandId) => {
      queueMicrotask(() => onCommand(commandId ?? "c"))
      return commandId ?? "c"
    },
    endpointCommand: async () => "c",
    list: async () => ({ query_id: "q", revision: 0, rows: [], incomplete: [], devices: {} }),
    read: async () => ({ entries: [], next_before: null }),
    oversizedLines: () => 0,
    close,
    closed,
  }
  const emit = (event: LocalEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  const session = world.sessions[0]
  if (session === undefined) throw new Error("the default world has no session")
  const snapshotEvent = (attach_id: number): LocalEvent => ({
    type: "event",
    kind: "session.snapshot",
    attach: "a1",
    ...session.snapshot,
    attach_id,
  })
  const records = (attach_id: number, text: string): LocalEvent => ({
    type: "event",
    kind: "session.records",
    attach: "a1",
    attach_id,
    records: [{ type: "message_update", text }],
  })
  return { client, emit, snapshotEvent, records }
}

async function attachOver(script: ReturnType<typeof scriptedClient>) {
  const service = await connectDeviceService({
    version: "5.1.52",
    stateDir: "/unused",
    connect: async () => script.client,
  })
  return service.attach("dev-peer-1", "s1")
}

describe("attach events", () => {
  test("a listener added later replays from the latest snapshot, not the whole attach", async () => {
    const script = scriptedClient()
    const attach = await attachOver(script)
    script.emit(script.snapshotEvent(1))
    script.emit(script.records(1, "old"))
    script.emit(script.snapshotEvent(2))
    script.emit(script.records(2, "new"))
    const seen: string[] = []
    attach.onEvent((event) =>
      seen.push(
        event.kind === "snapshot"
          ? `snapshot ${event.snapshot.attach_id}`
          : event.kind === "records"
            ? `records ${event.attach_id}`
            : event.kind,
      ),
    )
    expect(seen).toEqual(["snapshot 2", "records 2"])
  })

  // A command whose engine ends its own session (close_session, unload_session {force}): the host ends the attachment
  // (session.detached session_closed) while the command's reply and final state still arrive on the connection's
  // delegated channel toward that device, in either order relative to the end.
  const reply = (commandId: string): LocalEvent => ({
    type: "event",
    kind: "session.command_event",
    device: "dev-peer-1",
    command_id: commandId,
    response: { type: "response", command: "unload_session", success: true, data: { outcome: "unloaded" } },
  })
  const applied = (commandId: string): LocalEvent => ({
    type: "event",
    kind: "session.command_state",
    command_id: commandId,
    state: "engine_applied",
    retryable: false,
  })
  const endedBy = (reason: "session_closed" | "peer_detached"): LocalEvent => ({
    type: "event",
    kind: "session.detached",
    attach: "a1",
    reason,
  })
  const ended = endedBy("session_closed")
  const within = <T>(promise: Promise<T>, what: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited 5s for ${what}, it never settled`)), 5_000)
    })
    return Promise.race([promise, bound]).finally(() => clearTimeout(timer))
  }

  test.each([
    [
      "the end, then the reply and the applied state",
      "session_closed",
      (id: string) => [ended, reply(id), applied(id)],
    ],
    [
      "the reply, then the end, then the applied state",
      "session_closed",
      (id: string) => [reply(id), ended, applied(id)],
    ],
    // A client below its version entry is told peer_detached for the same end (docs/local-api.md, decision 0013).
    [
      "the older-client end, then the reply and the applied state",
      "peer_detached",
      (id: string) => [endedBy("peer_detached"), reply(id), applied(id)],
    ],
  ] as const)(
    "#given a command that ends its own session #when the host sends %s #then the command settles applied with the engine's reply",
    async (_label, reason, order) => {
      let script!: ReturnType<typeof scriptedClient>
      script = scriptedClient((commandId) => {
        for (const event of order(commandId)) script.emit(event)
      })
      const attach = await attachOver(script)
      const result = await within(
        attach.command({ type: "unload_session", sessionId: "s1", force: true }),
        "the unload's outcome",
      )
      expect(result.outcome.state).toBe("engine_applied")
      expect(result.response).toEqual({
        type: "response",
        command: "unload_session",
        success: true,
        data: { outcome: "unloaded" },
      })
      expect(await attach.detached).toBe(reason)
    },
  )

  test("#given the attach ended with a command in flight #when the connection then closes #then the command rejects instead of waiting", async () => {
    let script!: ReturnType<typeof scriptedClient>
    script = scriptedClient(() => {
      script.emit(ended)
      script.client.close()
    })
    const attach = await attachOver(script)
    const error = await within(
      attach.command({ type: "close_session", sessionId: "s1" }).then(
        () => undefined,
        (e: unknown) => e,
      ),
      "the command's rejection",
    )
    expect(String(error)).toContain("the attach ended before the command settled")
  })

  test("a listener that throws ends the attach with listener_failed and never reaches the connection", async () => {
    const script = scriptedClient()
    const attach = await attachOver(script)
    script.emit(script.snapshotEvent(1))
    const boom = new Error("renderer failed")
    attach.onEvent((event) => {
      if (event.kind === "records") throw boom
    })
    expect(() => script.emit(script.records(1, "x"))).not.toThrow()
    expect(await attach.detached).toBe("listener_failed")
    expect(attach.failure()).toBe(boom)
  })
})
