/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProbeFingerprintMatrixTool } from "./probe-fingerprint-matrix-tool"
import { createProbeFingerprintVerifyTool } from "./probe-fingerprint-verify-tool"

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

describe("fingerprint verification tools", () => {
  test("probe_fingerprint_verify #given tls.peet mock #when hashes match #then profile is verified", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ tls: { ja3_hash: "ja3-ok", ja4: "ja4-ok" } }) })
    const ctx = makeCtx()
    ctx.store.insertFingerprintProfile({ id: "fp-1", name: "fp", engine: "bun_fetch", user_agent: "ua", tls_fingerprint: "ja3-ok" })
    const resp = await createProbeFingerprintVerifyTool(ctx).execute({ fingerprint_id: "fp-1", test_url: server.url.toString() }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { actual_ja3: string; matched_expected: boolean }
    expect(parsed.actual_ja3).toBe("ja3-ok")
    expect(parsed.matched_expected).toBe(true)
    expect(ctx.store.getFingerprintProfile("fp-1")?.detection_score).toBe(0)
    server.stop(true)
    ctx.store.close()
  })

  test("probe_fingerprint_matrix #given mixed fingerprints #when verified #then best fingerprint is lowest score", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ tls: { ja3_hash: "ja3-best", ja4: "ja4-best" } }) })
    const ctx = makeCtx()
    ctx.store.insertFingerprintProfile({ id: "fp-best", name: "best", engine: "bun_fetch", user_agent: "ua", tls_fingerprint: "ja3-best" })
    ctx.store.insertFingerprintProfile({ id: "fp-bad", name: "bad", engine: "bun_fetch", user_agent: "ua", tls_fingerprint: "other" })
    const resp = await createProbeFingerprintMatrixTool(ctx).execute({ url: server.url.toString(), fingerprint_ids: ["fp-best", "fp-bad"], method: "GET" }, { sessionID: "test" } as never)
    const parsed = JSON.parse(resp as string) as { summary: { best_fingerprint: string; success_count: number } }
    expect(parsed.summary.best_fingerprint).toBe("fp-best")
    expect(parsed.summary.success_count).toBe(2)
    server.stop(true)
    ctx.store.close()
  })
})
