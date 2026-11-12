import { describe, expect, test } from "bun:test"

import { resolveTarget, type ThreadAddressEntry } from "../addressing"
import { relayAddressEntry } from "./address-book"
import type { RemoteSessionRow } from "./ports"

// Decision 0027: ONE resolver over local + relay entries. Local book has "worker" here; the relay book has "planner" on b
// (durable id published) and "planner" on c (older daemon, listing key only).
const LOCAL: ThreadAddressEntry = {
  thread_id: "0195f0c2-1a2b-7c3d-8e4f-000000000001",
  name: "worker",
  status: "live",
  cwd: "/w",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
}
const ROW_B: RemoteSessionRow = {
  device: "b",
  session_id: "eng-b",
  durable_id: "0195f0c2-1a2b-7c3d-8e4f-00000000000b",
  title: "planner",
  project: "/w",
  path: "/b/s.jsonl",
  state: "idle",
  updated_ms: 1,
}
const ROW_C: RemoteSessionRow = {
  device: "c",
  session_id: "eng-c",
  title: "planner",
  project: "/w",
  path: "/c/s.jsonl",
  state: "idle",
  updated_ms: 1,
}
const OPTS = { all_scope: true as const }

describe("one resolver over the local and relay address books (decision 0027)", () => {
  test("#given a durable id published by another device #when resolved #then the relay entry wins exactly, carrying its device and row", () => {
    const hit = resolveTarget([LOCAL, relayAddressEntry(ROW_B)], ROW_B.durable_id ?? "", OPTS)
    expect(hit).toMatchObject({
      kind: "ok",
      entry: { thread_id: ROW_B.durable_id, device: "b", transport: { kind: "relay", row: ROW_B } },
    })
  })
  test("#given a name unique to another device #when resolved #then that device's entry is the target", () => {
    const hit = resolveTarget([LOCAL, relayAddressEntry(ROW_B)], "planner", OPTS)
    expect(hit).toMatchObject({ kind: "ok", entry: { device: "b" } })
  })
  test("#given the same name on two other devices #when resolved #then ambiguous_target names both devices, never a silent pick", () => {
    const hit = resolveTarget([LOCAL, relayAddressEntry(ROW_B), relayAddressEntry(ROW_C)], "planner", OPTS)
    expect(hit).toMatchObject({ kind: "error", code: "ambiguous_target" })
    const devices = (hit as { candidates?: readonly { device?: string }[] }).candidates?.map((c) => c.device).sort()
    expect(devices).toEqual(["b", "c"])
  })
  test("#given an older daemon lists no durable id (D2: no id above the port) #when its listing key is addressed #then it is not an id hit; the row is still reachable by name", () => {
    expect(resolveTarget([LOCAL, relayAddressEntry(ROW_C)], "eng-c", OPTS)).toMatchObject({
      kind: "error",
      code: "not_found",
    })
    expect(resolveTarget([LOCAL, relayAddressEntry(ROW_C)], "planner", OPTS)).toMatchObject({
      kind: "ok",
      entry: { device: "c" },
    })
  })
})
