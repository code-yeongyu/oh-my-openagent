/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeCaptureGetTool } from "./probe-capture-get-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-capture-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function seedStore() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  store.insertHypothesis({ id: "h-1", text: "x", falsifiability_criteria: "c" })
  const session = store.insertSession({ id: "s-1", hypothesis_id: "h-1", identity_id: null })
  const ex1 = store.insertExchange({
    session_id: session.id,
    method: "POST",
    url: "https://x.test/a",
    response_status: 200,
    response_body: "alpha",
  })
  const ex2 = store.insertExchange({
    session_id: session.id,
    method: "POST",
    url: "https://x.test/b",
    response_status: 200,
    response_body: "beta",
  })
  return { store, pool, providerRegistry, session, exchangeIds: [ex1.id, ex2.id] }
}

describe("probe_capture_get", () => {
  test("json by session_id #given two exchanges in a session #when format=json #then returns inline exchanges with bodies", async () => {
    const ctx = seedStore()
    const tool = createProbeCaptureGetTool(ctx)
    const resp = await tool.execute(
      { session_id: ctx.session.id, format: "json", limit: 10, offset: 0, include_bodies: true, max_body_bytes: 1024 },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { exchanges: Array<{ response_body: string }>; total_count: number; export_file_path: string | null }
    expect(parsed.total_count).toBe(2)
    expect(parsed.exchanges.length).toBe(2)
    expect(parsed.exchanges[0]?.response_body).toBe("alpha")
    expect(parsed.export_file_path).toBeNull()
    ctx.store.close()
  })

  test("jsonl writes file #given session_id #when format=jsonl #then file exists with one exchange per line", async () => {
    const ctx = seedStore()
    const tool = createProbeCaptureGetTool(ctx)
    const resp = await tool.execute(
      { session_id: ctx.session.id, format: "jsonl", limit: 10, offset: 0, include_bodies: true, max_body_bytes: 1024 },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { exchanges: unknown[]; export_file_path: string; exchange_count: number }
    expect(parsed.exchanges.length).toBe(0)
    expect(parsed.export_file_path).toMatch(/probe-lab-captures-/)
    const lines = readFileSync(parsed.export_file_path, "utf-8").split("\n").filter((l) => l.length > 0)
    expect(lines.length).toBe(2)
    rmSync(parsed.export_file_path, { force: true })
    ctx.store.close()
  })

  test("provider metadata #given provider session #when jsonl exported #then line includes provider context", async () => {
    const store = createProbeStore(join(tmpDir, "lab-provider.db"))
    const pool = createIdentityPool({ store })
    const providerRegistry = createProviderRegistry({ store })
    store.insertProvider({ id: "p-cap", name: "cap-provider", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "none", auth_config: {} })
    store.insertSession({ id: "s-provider", hypothesis_id: null, identity_id: null, provider_id: "p-cap" })
    store.insertExchange({ session_id: "s-provider", method: "GET", url: "https://x.test/provider", response_status: 200 })
    const resp = await createProbeCaptureGetTool({ store, pool, providerRegistry }).execute(
      { session_id: "s-provider", format: "jsonl", limit: 10, offset: 0, include_bodies: false, max_body_bytes: 1024 },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { export_file_path: string }
    const first = JSON.parse(readFileSync(parsed.export_file_path, "utf-8").trim()) as { provider_id: string; provider_name: string }
    expect(first.provider_id).toBe("p-cap")
    expect(first.provider_name).toBe("cap-provider")
    rmSync(parsed.export_file_path, { force: true })
    store.close()
  })
})
