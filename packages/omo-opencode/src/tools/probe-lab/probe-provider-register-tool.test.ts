/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeProviderRegisterTool } from "./probe-provider-register-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-provider-"))
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

describe("probe_provider_register", () => {
  test("register #given valid args #when registered #then returns provider_id and status active", async () => {
    const ctx = makeCtx()
    const tool = createProbeProviderRegisterTool(ctx)
    const resp = await tool.execute(
      {
        name: "ds2api",
        provider_type: "openai_compatible",
        base_url: "http://localhost:38501",
        auth_type: "bearer_token",
        auth_config: { bearer_token: "tok-1" },
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { provider_id: string; status: string; encryption_status: string }
    expect(parsed.status).toBe("active")
    expect(parsed.encryption_status).toBe("aes-256-gcm")
    const stored = ctx.store.getProvider(parsed.provider_id)
    expect(stored?.name).toBe("ds2api")
    expect(stored?.provider_type).toBe("openai_compatible")
    ctx.store.close()
  })
})
