/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeProviderRefreshTool } from "./probe-provider-refresh-tool"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-refresh-"))
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

describe("probe_provider_refresh persistence", () => {
  test("probe_provider_refresh #given deepseek_web with old aws_waf_token + refresh_type=aws_waf_token #when called #then success and new token persisted to provider auth_config", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({
      id: "p-ds",
      name: "ds-web",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { aws_waf_token: "waf-old", session_cookie: "ds_session=keepme" },
    })
    const resp = await createProbeProviderRefreshTool(ctx).execute(
      { provider_id: "p-ds", refresh_type: "aws_waf_token" },
      { sessionID: "t" } as never,
    )
    const parsed = JSON.parse(resp as string) as { success: boolean; persisted: boolean; new_value_field: string | null }
    expect(parsed.success).toBe(true)
    expect(parsed.persisted).toBe(true)
    expect(parsed.new_value_field).toBe("aws_waf_token")
    const after = ctx.store.getProvider("p-ds")
    if (!after) throw new Error("provider lookup failed after refresh")
    const auth = JSON.parse(after.auth_config) as Record<string, string>
    expect(auth.aws_waf_token).toMatch(/^waf-/)
    expect(auth.aws_waf_token).not.toBe("waf-old")
    expect(auth.session_cookie).toBe("ds_session=keepme")
    ctx.store.close()
  })

  test("probe_provider_refresh #given non-existent provider #when called #then returns ERROR string", async () => {
    const ctx = makeCtx()
    const resp = await createProbeProviderRefreshTool(ctx).execute(
      { provider_id: "p-missing", refresh_type: "aws_waf_token" },
      { sessionID: "t" } as never,
    )
    expect(resp).toMatch(/^\[ERROR\] provider not found/)
    ctx.store.close()
  })

  test("probe_provider_refresh #given deepseek_web with unsupported refresh_type=cookies #when called #then success=false and persisted=false", async () => {
    const ctx = makeCtx()
    ctx.store.insertProvider({
      id: "p-ds2",
      name: "ds-web2",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { aws_waf_token: "waf-fixed" },
    })
    const resp = await createProbeProviderRefreshTool(ctx).execute(
      { provider_id: "p-ds2", refresh_type: "cookies" },
      { sessionID: "t" } as never,
    )
    const parsed = JSON.parse(resp as string) as { success: boolean; persisted: boolean }
    expect(parsed.success).toBe(false)
    expect(parsed.persisted).toBe(false)
    const after = ctx.store.getProvider("p-ds2")
    if (!after) throw new Error("provider lookup failed")
    const auth = JSON.parse(after.auth_config) as Record<string, string>
    expect(auth.aws_waf_token).toBe("waf-fixed")
    ctx.store.close()
  })
})
