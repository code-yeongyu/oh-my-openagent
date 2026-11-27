// Device B's engine host as the fake relay and the observer reach it: the thread-tools QA kit's EndpointClient on B's
// host socket, with the engine's own socket handshake. Records go to B's real engine; its replies come back unchanged.
import { bus, EndpointClient } from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import type { JsonObject } from "../../../../packages/device-service-core/src/local-api/protocol.ts"
import type { EnginePort, EngineSession } from "./fake-relay.ts"

const REQUEST_WAIT_MS = 120_000
// An endpoint key is 22 base64url characters on the local API (validate-delegated.ts ENDPOINT_KEY).
const B_ENDPOINT_KEY = "x1aBhostEndpointKey000"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === "string" ? value : "")

export const connectEngine = (socket: string, label: string): Promise<EndpointClient> =>
  EndpointClient.connect(socket, label)

/** B's sessions as its engine lists them: the routing id is the relay's key, the durable id the engine's own. */
export async function listSessions(client: EndpointClient): Promise<readonly EngineSession[]> {
  const listed = await client.request({ type: "list_sessions", observe: true }, { timeoutMs: REQUEST_WAIT_MS })
  const data = isObject(listed["data"]) ? listed["data"] : {}
  const rows = Array.isArray(data["sessions"]) ? data["sessions"] : []
  return rows.filter(isObject).map((row) => ({
    key: text(row["sessionId"]),
    engineId: text(row["durableSessionId"]) || text(row["sessionId"]),
    name: text(row["sessionName"]) || text(row["name"]),
    cwd: text(row["cwd"]),
    state: row["isStreaming"] === true ? ("running" as const) : ("idle" as const),
  }))
}

export async function enginePort(socket: string): Promise<EnginePort> {
  const client = await connectEngine(socket, "x1a-relay-b")
  const listeners = new Set<(frame: JsonObject) => void>()
  let seen = 0
  const onTick = (): void => {
    for (; seen < client.records.length; seen += 1) {
      const record = client.records[seen]
      if (record === undefined || record["type"] === "response") continue
      for (const listener of listeners) listener(record as JsonObject)
    }
  }
  bus.on("tick", onTick)
  return {
    endpoint: B_ENDPOINT_KEY,
    request: async (record) => {
      const { id: _relayId, ...rest } = record
      return (await client.request(rest, { timeoutMs: REQUEST_WAIT_MS })) as JsonObject
    },
    onFrame: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sessions: () => listSessions(client),
    close: async () => {
      bus.off("tick", onTick)
      client.close()
    },
  }
}
