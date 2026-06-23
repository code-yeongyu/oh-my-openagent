/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeExportTool } from "./probe-export-tool"
import { createProbeProviderRotateTool } from "./probe-provider-rotate-tool"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-v05-exp-"))
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

describe("probe-lab v0.5 export carryovers", () => {
  test("probe_export openapi_yaml #given exchanges #when export runs #then yaml output references methods and operationIds", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-y", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({ session_id: "s-y", method: "GET", url: "https://example.test/v1/echo", response_status: 200 })
    const tool = createProbeExportTool(ctx)
    const resp = await tool.execute({ session_id: "s-y", format: "openapi_yaml" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { file_path: string }
    const content = await Bun.file(parsed.file_path).text()
    expect(content).toContain("openapi: 3.0.0")
    expect(content).toContain("operationId: get_v1_echo")
    ctx.store.close()
  })

  test("probe_export mitmproxy_mitm #given exchanges #when export runs #then JSONL flow lines are emitted", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-m", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({ session_id: "s-m", method: "POST", url: "https://api.example.test/v1/x", request_headers: { Authorization: "Bearer s" }, request_body: "hi", response_status: 200 })
    const resp = await createProbeExportTool(ctx).execute({ session_id: "s-m", format: "mitmproxy_mitm" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { file_path: string }
    const content = await Bun.file(parsed.file_path).text()
    const flow = JSON.parse(content.split("\n")[0]!) as { type: string; request: { method: string; host: string } }
    expect(flow.type).toBe("http")
    expect(flow.request.method).toBe("POST")
    expect(flow.request.host).toBe("api.example.test")
    ctx.store.close()
  })

  test("probe_export curl_replay #given exchange #when export runs #then bash script with curl command is emitted", async () => {
    const ctx = makeCtx()
    ctx.store.insertSession({ id: "s-c", hypothesis_id: null, identity_id: null })
    ctx.store.insertExchange({ session_id: "s-c", method: "POST", url: "https://api.example.test/v1/y", request_headers: { Authorization: "Bearer secret" }, request_body: "{}", response_status: 200 })
    const resp = await createProbeExportTool(ctx).execute({ session_id: "s-c", format: "curl_replay", anonymize_credentials: true }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { file_path: string }
    const content = await Bun.file(parsed.file_path).text()
    expect(content).toContain("#!/usr/bin/env bash")
    expect(content).toContain("curl -sS -X POST")
    expect(content).toContain("REDACTED")
    expect(content).not.toContain("Bearer secret")
    ctx.store.close()
  })
})

describe("probe-lab v0.5 provider rotate carryovers", () => {
  test("probe_provider_rotate proxy #given provider #when proxy rotation requested #then auth_config.proxy_url is updated", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({ id: "p-proxy", name: "proxy", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" } })
    const resp = await createProbeProviderRotateTool(ctx).execute({ provider_id: "p-proxy", rotation_type: "proxy", reason: "test" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { rotation_type: string; new_value_hash: string }
    expect(parsed.rotation_type).toBe("proxy")
    expect(parsed.new_value_hash.length).toBeGreaterThan(10)
    expect(JSON.parse(ctx.store.getProvider("p-proxy")!.auth_config).proxy_url).toMatch(/^http:\/\//)
    ctx.store.close()
  })

  test("probe_provider_rotate fingerprint #given fingerprint and identity #when fingerprint rotation requested #then identity is updated", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({ id: "p-fp", name: "fp", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" } })
    ctx.store.insertFingerprintProfile({ id: "fp-1", name: "fp1", engine: "bun_fetch", user_agent: "ua1" })
    ctx.store.upsertIdentity({ id: "id-1", kind: "api_key", config: { fingerprint_profile_id: "old" }, provider_id: "p-fp" })
    const resp = await createProbeProviderRotateTool(ctx).execute({ provider_id: "p-fp", rotation_type: "fingerprint", reason: "rotate fp" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { rotation_type: string; new_value_hash: string }
    expect(parsed.rotation_type).toBe("fingerprint")
    expect(parsed.new_value_hash.length).toBeGreaterThan(10)
    expect(ctx.store.getIdentity("id-1")!.fingerprint_profile_id).toBe("fp-1")
    ctx.store.close()
  })

  test("probe_provider_rotate fingerprint #given identity with sensitive config #when fingerprint rotation requested #then token and proxy are preserved", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({ id: "p-keep", name: "keep", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" } })
    ctx.store.insertFingerprintProfile({ id: "fp-A", name: "fpA", engine: "bun_fetch", user_agent: "uaA" })
    ctx.store.insertFingerprintProfile({ id: "fp-B", name: "fpB", engine: "bun_fetch", user_agent: "uaB" })
    ctx.store.updateFingerprintLastVerifiedAt("fp-A", Math.floor(Date.now() / 1000))
    ctx.store.upsertIdentity({
      id: "id-keep",
      kind: "api_key",
      config: { token: "secret-tok", proxy: "http://proxy:8080", fingerprint_profile_id: "fp-A" },
      provider_id: "p-keep",
    })
    const resp = await createProbeProviderRotateTool(ctx).execute({ provider_id: "p-keep", rotation_type: "fingerprint", reason: "preserve config" }, { sessionID: "t" } as never)
    expect(typeof resp === "string" && !resp.startsWith("[ERROR]")).toBe(true)
    const identity = ctx.store.getIdentity("id-keep")!
    const config = JSON.parse(identity.config) as { token?: string; proxy?: string; fingerprint_profile_id?: string }
    expect(config.token).toBe("secret-tok")
    expect(config.proxy).toBe("http://proxy:8080")
    expect(identity.fingerprint_profile_id).toBe("fp-B")
    ctx.store.close()
  })
})
