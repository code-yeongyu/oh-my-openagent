/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCanaryManager } from "./canary-manager"
import { createProbeStore } from "./sqlite-store"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-canary-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("canary manager", () => {
  test("promoteCanaries #given active identities #when promoted #then least-used identities become canary", () => {
    const store = createProbeStore(join(tmpDir, "lab.db"))
    store.upsertIdentity({ id: "id-a", kind: "api_key", config: {}, status: "active" })
    store.upsertIdentity({ id: "id-b", kind: "api_key", config: {}, status: "active" })
    const manager = createCanaryManager({ store })
    expect(manager.promoteCanaries(2)).toBe(2)
    expect(manager.getCanaryHealth().canary_count).toBe(2)
    store.close()
  })

  test("runCanaryTest #given failing canary #when fails three times #then circuit opens", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("fail", { status: 500 }) })
    const store = createProbeStore(join(tmpDir, "lab.db"))
    store.upsertIdentity({ id: "id-canary", kind: "api_key", config: {}, status: "active", tier: "canary" })
    store.insertCanaryLock({ identity_id: "id-canary", locked_by: "test", lock_reason: "test", canary_test_url: server.url.toString(), canary_test_expected_status: 200 })
    const manager = createCanaryManager({ store })
    expect(await manager.runCanaryTest("id-canary")).toBe("fail")
    expect(await manager.runCanaryTest("id-canary")).toBe("fail")
    expect(await manager.runCanaryTest("id-canary")).toBe("fail")
    expect(store.getIdentity("id-canary")?.circuit_state).toBe("open")
    server.stop(true)
    store.close()
  })
})
