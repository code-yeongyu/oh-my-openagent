import { describe, expect, test } from "bun:test"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { closingPorts } from "../../thread/remote/testing/closing-ports"

const sessionsPort = closingPorts()

const ROW = { device: "b", title: "t", project: "/p", path: "/p/s.jsonl", state: "idle", updated_ms: 2 }

describe("device-service port: the listing row fields the thread tools read", () => {
  test("#given rows 4 listing rows, one from a device's cached snapshot #when the account is listed #then model, archived flag and the snapshot's as_of reach the port, and a row without them carries none", async () => {
    const service = {
      sessions: async () => ({
        rows: [
          { ...ROW, session_id: "s1", source: "live", as_of: 2, model: { provider: "p", id: "m" }, archived: true },
          { ...ROW, session_id: "s2", source: "live", as_of: 2 },
          { ...ROW, session_id: "s3", source: "cache", as_of: 1 },
        ],
        incomplete: [],
      }),
      closed: new Promise(() => {}),
      close: () => undefined,
    } as unknown as DeviceService
    const port = sessionsPort({ version: "0.0.0-test", connect: async () => ({ conn: service, owned: true }) })
    expect(await port.sessions()).toEqual([
      { ...ROW, session_id: "s1", source: "live", model: { provider: "p", id: "m" }, archived: true },
      { ...ROW, session_id: "s2", source: "live" },
      { ...ROW, session_id: "s3", source: "cache", as_of: 1 },
    ])
  })
})
