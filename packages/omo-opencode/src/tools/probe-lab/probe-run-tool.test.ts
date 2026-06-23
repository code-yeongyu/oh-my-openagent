/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { startMockServer, type MockServer } from "../../features/probe-lab/providers/mock-server"
import { createProbeRunTool } from "./probe-run-tool"

let tmpDir: string
let providerServer: MockServer | null = null
let fallbackServer: MockServer | null = null

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-run-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  providerServer?.close()
  providerServer = null
  fallbackServer?.close()
  fallbackServer = null
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe_run adapter routing", () => {
  test("provider path #given a registered ds2api provider with mock backend #when probe_run is called with provider_id #then request goes via adapter (Bearer header injected) and session.provider_id is persisted", async () => {
    providerServer = startMockServer((req) => {
      const auth = req.headers.get("authorization")
      if (auth !== "Bearer tok-prov") {
        return new Response("missing auth", { status: 401 })
      }
      return new Response("via-adapter", { status: 200 })
    })
    const ctx = makeCtx()
    const provider = ctx.store.insertProvider({
      id: "p-1",
      name: "ds2api-routed",
      provider_type: "ds2api",
      base_url: providerServer.url,
      auth_type: "bearer_token",
      auth_config: { bearer_token: "tok-prov" },
    })
    const tool = createProbeRunTool(ctx)
    const resp = await tool.execute(
      {
        url: `${providerServer.url}/v1/chat/completions`,
        method: "POST",
        body: "{}",
        provider_id: provider.id,
        timeout_ms: 5000,
        forward_as_is: false,
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { ok: boolean; status: number; provider_id: string; session_id: string; response_body_preview: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe(200)
    expect(parsed.provider_id).toBe(provider.id)
    expect(parsed.response_body_preview).toBe("via-adapter")
    const persistedSession = ctx.store.findSessionByLabel(parsed.session_id) ?? null
    expect(persistedSession?.provider_id).toBe(provider.id)
    ctx.store.close()
  })

  test("fallback path #given no provider_id #when probe_run is called #then raw dispatch is used and session.provider_id is null", async () => {
    fallbackServer = startMockServer((req) => {
      const auth = req.headers.get("authorization")
      expect(auth).toBeNull()
      return new Response("via-raw", { status: 200 })
    })
    const ctx = makeCtx()
    const tool = createProbeRunTool(ctx)
    const resp = await tool.execute(
      {
        url: `${fallbackServer.url}/`,
        method: "POST",
        body: "{}",
        timeout_ms: 5000,
        forward_as_is: false,
      },
      { sessionID: "test" } as never,
    )
    const parsed = JSON.parse(resp as string) as { ok: boolean; status: number; provider_id: string | null; session_id: string; response_body_preview: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe(200)
    expect(parsed.provider_id).toBeNull()
    expect(parsed.response_body_preview).toBe("via-raw")
    const persistedSession = ctx.store.findSessionByLabel(parsed.session_id) ?? null
    expect(persistedSession?.provider_id).toBeNull()
    ctx.store.close()
  })

  test("provider not found #given an unknown provider_id #when probe_run is called #then returns ERROR without inserting session", async () => {
    const ctx = makeCtx()
    const tool = createProbeRunTool(ctx)
    const resp = await tool.execute(
      {
        url: "http://localhost:1/",
        method: "POST",
        provider_id: "p-nope",
        timeout_ms: 5000,
        forward_as_is: false,
      },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toContain("[ERROR] provider not found: p-nope")
    ctx.store.close()
  })

  test("global kill switch #given config is active #when probe_run is called #then request is rejected before dispatch", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("global_kill_switch", "true", "test stop")
    const resp = await createProbeRunTool(ctx).execute(
      { url: "http://localhost:1/", method: "GET", timeout_ms: 5000, forward_as_is: false },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toBe("[ERROR] global_kill_switch is active; probe_run rejected. Disable via probe_lab_config to resume.")
    expect(ctx.store.countExchangesForSession("missing-session")).toBe(0)
    ctx.store.close()
  })

  test("session label conflict #given label bound to provider #when another provider requests same label #then returns ERROR", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({ id: "p-a", name: "a", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "none", auth_config: {} })
    ctx.store.insertProvider({ id: "p-b", name: "b", provider_type: "ds2api", base_url: "http://localhost:2", auth_type: "none", auth_config: {} })
    ctx.store.insertSession({ id: "s-conflict", hypothesis_id: null, identity_id: null, provider_id: "p-a", config: { label: "shared" } })
    const resp = await createProbeRunTool(ctx).execute(
      { url: "http://localhost:2/", method: "GET", provider_id: "p-b", session_label: "shared", timeout_ms: 5000, forward_as_is: false },
      { sessionID: "test" } as never,
    )
    expect(resp as string).toBe("[ERROR] session label 'shared' already has provider 'p-a', cannot mix with 'p-b'")
    ctx.store.close()
  })
})
