/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProbeCanaryLockTool } from "./probe-canary-lock-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-canary-tool-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe_canary_lock", () => {
  test("lock and release #given identity #when managed #then lock lifecycle is persisted", async () => {
    const ctx = makeCtx()
    ctx.store.upsertIdentity({ id: "id-tool", kind: "api_key", config: {}, status: "active" })
    const tool = createProbeCanaryLockTool(ctx)
    const locked = await tool.execute({ identity_id: "id-tool", action: "lock", lock_reason: "guard" }, { sessionID: "test" } as never)
    expect(JSON.parse(locked as string).new_status).toBe("locked")
    expect(ctx.store.getCanaryLockByIdentity("id-tool")?.lock_reason).toBe("guard")
    const released = await tool.execute({ identity_id: "id-tool", action: "release" }, { sessionID: "test" } as never)
    expect(JSON.parse(released as string).new_status).toBe("released")
    expect(ctx.store.getCanaryLockByIdentity("id-tool")).toBeNull()
    ctx.store.close()
  })
})
