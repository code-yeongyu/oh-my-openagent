/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool, PoolUnhealthyError } from "./identity-pool"
import { createProbeStore, type ProbeStore } from "./sqlite-store"

let tmpDir: string
let dbPath: string
let store: ProbeStore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-pool-"))
  dbPath = join(tmpDir, "lab.db")
  store = createProbeStore(dbPath)
})

afterEach(() => {
  store.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("createIdentityPool acquire ordering", () => {
  test("expired quarantine #given a single identity past quarantined_until #when acquire runs #then promotion happens before health gate and identity is returned half_open", () => {
    const past = Math.floor(Date.now() / 1000) - 100
    store.upsertIdentity({ id: "id-recover", kind: "api_key", config: { token: "x" } })
    store.setIdentityCircuitState({
      id: "id-recover",
      state: "open",
      consecutiveFailures: 5,
      lastFailureAt: past - 600,
      quarantinedUntil: past,
      status: "quarantined",
    })
    expect(store.getPoolHealth().quarantined_ratio).toBe(1)
    const pool = createIdentityPool({ store })
    const acquired = pool.acquire()
    expect(acquired.identity.id).toBe("id-recover")
    expect(acquired.identity.status).toBe("active")
    expect(acquired.identity.circuit_state).toBe("half_open")
    expect(acquired.identity.quarantined_until).toBeNull()
    expect(acquired.identity.consecutive_failures).toBe(0)
    expect(store.getPoolHealth().quarantined_ratio).toBe(0)
  })

  test("genuinely unhealthy pool #given two identities both fresh-quarantined #when acquire runs #then PoolUnhealthyError is thrown and ratio remains 1", () => {
    const future = Math.floor(Date.now() / 1000) + 60
    for (const id of ["id-a", "id-b"]) {
      store.upsertIdentity({ id, kind: "api_key", config: { token: id } })
      store.setIdentityCircuitState({
        id,
        state: "open",
        consecutiveFailures: 5,
        lastFailureAt: Math.floor(Date.now() / 1000),
        quarantinedUntil: future,
        status: "quarantined",
      })
    }
    const pool = createIdentityPool({ store })
    expect(() => pool.acquire()).toThrow(PoolUnhealthyError)
    expect(store.getPoolHealth().quarantined_ratio).toBe(1)
  })
})
