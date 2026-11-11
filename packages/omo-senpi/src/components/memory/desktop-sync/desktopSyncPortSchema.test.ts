import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import {
  SYNC_REPLY_MAX_ITEMS,
  SyncDevices,
  decodeRecoveryWraps,
  decodeSyncEntries,
  decodeSyncKeys,
} from "./desktopSyncPortSchema"

const principal = { kind: "device", id: "d", signing_public_key: "s", sealing_public_key: "p" }
const row = {
  seq: 1,
  base_seq: 0,
  kind: "batch",
  account: "a",
  epoch: 0,
  author: principal,
  digest: "g",
  link: "l",
  keyring_link: null,
  record_sig: "r",
}
const keyring = {
  ...row,
  kind: "keyring",
  keyring_link: "k",
  body: { kind: "keyring", account: "a", epoch: 0 },
  wraps: [],
}
const wrap = { record: { seq: 1, digest: "g", keyring_link: "k" }, entry: { epoch: 0, id: "w", wrap: "x" } }
const device = {
  id: "d",
  name: "n",
  kind: "cli",
  platform: "linux",
  createdAt: "t",
  lastSeenAt: "t",
  current: false,
  syncing: false,
  revokedAt: null,
  syncPrincipal: null,
}
const many = <T>(item: T, n: number): T[] => Array.from({ length: n }, () => item)

const expectTooBig = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError)
    expect((error as ZodError).issues.some((issue) => issue.code === "too_big")).toBe(true)
    return
  }
  throw new Error("expected the oversized reply to be rejected")
}

describe("desktop sync reply size cap", () => {
  test("#given a reply one item over the cap #when each decoder parses it #then it is rejected as too big", () => {
    expectTooBig(() => decodeSyncEntries({ entries: many(row, SYNC_REPLY_MAX_ITEMS + 1) }))
    expectTooBig(() => decodeSyncKeys({ entries: many(keyring, SYNC_REPLY_MAX_ITEMS + 1) }))
    expectTooBig(() => decodeRecoveryWraps({ wraps: many(wrap, SYNC_REPLY_MAX_ITEMS + 1) }))
    expectTooBig(() => decodeSyncKeys({ entries: [{ ...keyring, wraps: many(wrap.entry, SYNC_REPLY_MAX_ITEMS + 1) }] }))
    expectTooBig(() => SyncDevices.parse({ devices: many(device, SYNC_REPLY_MAX_ITEMS + 1) }))
  })

  test("#given a reply exactly at the cap #when it is parsed #then it is accepted", () => {
    expect(decodeSyncEntries({ entries: many(row, SYNC_REPLY_MAX_ITEMS) }).entries).toHaveLength(SYNC_REPLY_MAX_ITEMS)
  })
})
