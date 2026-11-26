import { expect, test } from "bun:test"

import { readMemoryRpcSync } from "./memory-rpc-sync"

const AT = Date.parse("2026-11-17T10:00:00.000Z")

test("#given an engine that caught up after an offline gap #when the desktop snapshot is read #then appliedWhileOffline carries the count", async () => {
  expect(await readMemoryRpcSync(async () => ({ kind: "synced", at: AT, updatedWhileOffline: 3 }), "/repo")).toEqual({
    state: "synced",
    lastSyncedAtISO: "2026-11-17T10:00:00.000Z",
    appliedWhileOffline: 3,
  })
})

test("#given an offline gap that brought nothing new #when the desktop snapshot is read #then appliedWhileOffline is zero", async () => {
  expect(await readMemoryRpcSync(async () => ({ kind: "synced", at: AT, updatedWhileOffline: 0 }), "/repo")).toEqual({
    state: "synced",
    lastSyncedAtISO: "2026-11-17T10:00:00.000Z",
    appliedWhileOffline: 0,
  })
})

test("#given no offline gap #when the desktop snapshot is read #then the snapshot has no appliedWhileOffline field", async () => {
  expect(await readMemoryRpcSync(async () => ({ kind: "synced", at: AT }), "/repo")).toEqual({
    state: "synced",
    lastSyncedAtISO: "2026-11-17T10:00:00.000Z",
  })
})
