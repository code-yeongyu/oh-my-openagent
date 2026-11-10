import { describe, expect, test } from "bun:test"

import type { RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { locateAcross } from "./remote-ops"

// #12996: a delivery header names its sender by the omo DURABLE id (sender_session); the account listing names each
// session by its device's engine session id. A reply addressed to the durable id must reach the sender's row.
const ROW_B: RemoteSessionRow = { device: "b", session_id: "eng-on-b", durable_id: "8f3b2c1a-0000-4000-8000-00000000000b", title: "planner", project: "/w", path: "/b/s.jsonl", state: "idle", updated_ms: 1 }
const ROW_HERE: RemoteSessionRow = { device: "a", session_id: "eng-here", durable_id: "8f3b2c1a-0000-4000-8000-00000000000a", title: "worker", project: "/w", path: "/a/s.jsonl", state: "idle", updated_ms: 1 }
const surface = (rows: readonly RemoteSessionRow[]): RemoteThreadSurface => ({
  sessions: { thisDevice: async () => "a", sessions: async () => rows, devices: async () => [], endpointCommand: async () => { throw new Error("unused") }, sessionCommand: async () => { throw new Error("unused") }, read: async () => { throw new Error("unused") } },
  chain: { stamp: (record: object) => record },
} as unknown as RemoteThreadSurface)

describe("locateAcross resolves a durable id the listing carries (#12996)", () => {
  test("#given a row on another device whose durable_id is the address #when located #then it is that remote row", async () => {
    expect(await locateAcross(surface([ROW_HERE, ROW_B]), ROW_B.durable_id ?? "")).toEqual({ where: "remote", row: ROW_B })
  })
  test("#given the address is this device's own durable id #when located #then it is here, by its engine session id", async () => {
    expect(await locateAcross(surface([ROW_HERE, ROW_B]), ROW_HERE.durable_id ?? "")).toEqual({ where: "here", session_id: "eng-here" })
  })
  test("#given an engine session id #when located #then the exact session_id match still wins", async () => {
    expect(await locateAcross(surface([ROW_HERE, ROW_B]), "eng-on-b")).toEqual({ where: "remote", row: ROW_B })
  })
})
