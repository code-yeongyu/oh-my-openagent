/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeFingerprintRegisterTool } from "./probe-fingerprint-register-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-fp-"))
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

describe("probe_fingerprint_register", () => {
  test("register #given a bun_fetch fingerprint #when registered #then returns id with default detection_risk 0.5", async () => {
    const ctx = makeCtx()
    const tool = createProbeFingerprintRegisterTool(ctx)
    const resp = await tool.execute(
      {
        name: "fp-default",
        engine: "bun_fetch",
        user_agent: "Mozilla/5.0",
        http_version: "HTTP/2",
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { fingerprint_id: string; engine: string; detection_risk: number }
    expect(parsed.engine).toBe("bun_fetch")
    expect(parsed.detection_risk).toBe(0.5)
    const stored = ctx.store.getFingerprintProfile(parsed.fingerprint_id)
    expect(stored?.user_agent).toBe("Mozilla/5.0")
    expect(stored?.detection_score).toBe(0.5)
    ctx.store.close()
  })
})
