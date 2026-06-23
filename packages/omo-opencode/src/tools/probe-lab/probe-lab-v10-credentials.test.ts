/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeCredentialsAutoRotateTool } from "./probe-credentials-auto-rotate-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-credentials-"))
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

type Trigger = { provider_id: string; action: string; rotation_type?: string; refresh_type?: string }

describe("probe-lab v1.0 credentials auto-rotation", () => {
  test("probe_credentials_auto_rotate #given ds2api provider with expires_at < +1h #when called #then trigger action=rotate rotation_type=api_key", async () => {
    const ctx = makeCtx()
    const expiresSoon = Math.floor(Date.now() / 1000) + 600
    ctx.store.insertProvider({
      id: "p-exp",
      name: "expiring",
      provider_type: "ds2api",
      base_url: "http://localhost:1",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "x", expires_at: String(expiresSoon) },
    })
    const resp = await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: false, execute: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { triggers: Trigger[] }
    const found = parsed.triggers.find((t) => t.provider_id === "p-exp")
    expect(found?.action).toBe("rotate")
    expect(found?.rotation_type).toBe("api_key")
    ctx.store.close()
  })

  test("probe_credentials_auto_rotate #given deepseek_web provider with expires_at < +1h #when called #then trigger action=refresh refresh_type=aws_waf_token", async () => {
    const ctx = makeCtx()
    const expiresSoon = Math.floor(Date.now() / 1000) + 600
    ctx.store.insertProvider({
      id: "p-ds-exp",
      name: "ds-expiring",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { aws_waf_token: "waf-old", expires_at: String(expiresSoon) },
    })
    const resp = await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: false, execute: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { triggers: Trigger[] }
    const found = parsed.triggers.find((t) => t.provider_id === "p-ds-exp")
    expect(found?.action).toBe("refresh")
    expect(found?.refresh_type).toBe("aws_waf_token")
    ctx.store.close()
  })

  test("probe_credentials_auto_rotate #given 5 consecutive 401s #when called #then trigger action=rotate rotation_type=api_key", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({
      id: "p-401",
      name: "auth-failing",
      provider_type: "ds2api",
      base_url: "http://localhost:1",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "x" },
    })
    for (let i = 0; i < 5; i++) {
      ctx.store.insertAuditLog({ entity_type: "provider", entity_id: "p-401", action: "auth_fail" })
    }
    const resp = await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: false, execute: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { triggers: Trigger[] }
    const found = parsed.triggers.find((t) => t.provider_id === "p-401")
    expect(found?.action).toBe("rotate")
    expect(found?.rotation_type).toBe("api_key")
    ctx.store.close()
  })

  test("probe_credentials_auto_rotate apply=true #given trigger #when called #then audit log row recorded", async () => {
    const ctx = makeCtx()
    const expiresSoon = Math.floor(Date.now() / 1000) + 100
    ctx.store.insertProvider({
      id: "p-apply",
      name: "apply",
      provider_type: "ds2api",
      base_url: "http://localhost:1",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "x", expires_at: String(expiresSoon) },
    })
    await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: true, execute: false }, { sessionID: "t" } as never)
    const audit = ctx.store.listAuditLog({ entity_type: "provider", entity_id: "p-apply", action: "auto_rotate_recommended", limit: 5, offset: 0 })
    expect(audit.total).toBe(1)
    ctx.store.close()
  })

  test("probe_credentials_auto_rotate execute=true #given deepseek_web with expiring aws_waf_token #when called #then refresh tool invoked, new token persisted, both audit rows recorded", async () => {
    const ctx = makeCtx()
    const expiresSoon = Math.floor(Date.now() / 1000) + 100
    ctx.store.insertProvider({
      id: "p-ds-exec",
      name: "ds-exec",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { aws_waf_token: "waf-pre", expires_at: String(expiresSoon) },
    })
    const resp = await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: true, execute: true }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as {
      triggers: Trigger[]
      executed: boolean
      executions: Array<{ provider_id: string; invoked_tool: string; result: string }>
    }
    expect(parsed.executed).toBe(true)
    const exec = parsed.executions.find((e) => e.provider_id === "p-ds-exec")
    expect(exec?.invoked_tool).toBe("probe_provider_refresh")
    const after = ctx.store.getProvider("p-ds-exec")
    if (!after) throw new Error("provider lookup failed after auto-rotate execute")
    const auth = JSON.parse(after.auth_config) as Record<string, string>
    expect(auth.aws_waf_token).toMatch(/^waf-/)
    expect(auth.aws_waf_token).not.toBe("waf-pre")
    const recommended = ctx.store.listAuditLog({ entity_type: "provider", entity_id: "p-ds-exec", action: "auto_rotate_recommended", limit: 5, offset: 0 })
    const executed = ctx.store.listAuditLog({ entity_type: "provider", entity_id: "p-ds-exec", action: "auto_rotate_executed", limit: 5, offset: 0 })
    expect(recommended.total).toBe(1)
    expect(executed.total).toBe(1)
    ctx.store.close()
  })

  test("probe_credentials_auto_rotate #given fresh provider #when called #then no triggers", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({
      id: "p-fresh",
      name: "fresh",
      provider_type: "ds2api",
      base_url: "http://localhost:1",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "x", expires_at: String(Math.floor(Date.now() / 1000) + 86_400) },
    })
    const resp = await createProbeCredentialsAutoRotateTool(ctx).execute({ apply: false, execute: false }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { triggers: Trigger[] }
    expect(parsed.triggers.length).toBe(0)
    ctx.store.close()
  })
})
