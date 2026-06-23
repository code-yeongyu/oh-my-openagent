/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { getProbeLabContext, resetProbeLabContextForTests } from "../../features/probe-lab/probe-lab-context"
import { __setCookieCapturerForTest, createProbeProviderBootstrapTool } from "./probe-provider-bootstrap-tool"

const tmpRoots: string[] = []

function freshCtx() {
  resetProbeLabContextForTests()
  const dir = mkdtempSync(join(tmpdir(), "probe-lab-bootstrap-"))
  tmpRoots.push(dir)
  return getProbeLabContext({ dbPath: join(dir, "probe.db") })
}

afterEach(() => {
  __setCookieCapturerForTest(null)
  resetProbeLabContextForTests()
  for (const dir of tmpRoots.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { void 0 }
  }
})

function executeTool(toolDef: ReturnType<typeof createProbeProviderBootstrapTool>, args: { provider_id: string }): Promise<string> {
  return (toolDef.execute as (a: { provider_id: string }) => Promise<string>)(args)
}

describe("probe_provider_bootstrap", () => {
  test("#given unknown provider_id #when invoked #then returns ERROR", async () => {
    const ctx = freshCtx()
    const t = createProbeProviderBootstrapTool(ctx)
    const result = await executeTool(t, { provider_id: "missing-id" })
    expect(result).toMatch(/provider not found/)
  })

  test("#given non-deepseek_web provider #when invoked #then returns ERROR with provider_type info", async () => {
    const ctx = freshCtx()
    ctx.store.insertProvider({
      id: "p-openai",
      name: "openai",
      provider_type: "openai_official",
      base_url: "https://api.openai.com",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "tok" },
    })
    const t = createProbeProviderBootstrapTool(ctx)
    const result = await executeTool(t, { provider_id: "p-openai" })
    expect(result).toMatch(/supports provider_type 'deepseek_web' only/)
    expect(result).toMatch(/openai_official/)
  })

  test("#given deepseek_web provider and capturer returns aws-waf-token #when invoked #then persists aws_waf_token to auth_config", async () => {
    const ctx = freshCtx()
    ctx.store.insertProvider({
      id: "p-ds",
      name: "ds-web",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { existing_field: "preserved" },
    })
    __setCookieCapturerForTest(async () => ({ "aws-waf-token": "token-abc-123", session: "sess-xyz" }))
    const t = createProbeProviderBootstrapTool(ctx)
    const raw = await executeTool(t, { provider_id: "p-ds" })
    const parsed = JSON.parse(raw) as { success: boolean; cookies_captured: string[]; persisted_field: string }
    expect(parsed.success).toBe(true)
    expect(parsed.persisted_field).toBe("aws_waf_token")
    expect(parsed.cookies_captured).toContain("aws-waf-token")

    const updated = ctx.store.getProvider("p-ds")
    const cfg = JSON.parse(updated!.auth_config) as Record<string, string>
    expect(cfg.aws_waf_token).toBe("token-abc-123")
    expect(cfg.existing_field).toBe("preserved")
  })

  test("#given deepseek_web provider but capturer returns no aws-waf-token #when invoked #then reports success: false without persisting", async () => {
    const ctx = freshCtx()
    ctx.store.insertProvider({
      id: "p-ds-empty",
      name: "ds-empty",
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: { keep: "this" },
    })
    __setCookieCapturerForTest(async () => ({ other: "cookie" }))
    const t = createProbeProviderBootstrapTool(ctx)
    const raw = await executeTool(t, { provider_id: "p-ds-empty" })
    const parsed = JSON.parse(raw) as { success: boolean; message: string }
    expect(parsed.success).toBe(false)
    expect(parsed.message).toMatch(/no aws-waf-token cookie/)

    const cfg = JSON.parse(ctx.store.getProvider("p-ds-empty")!.auth_config) as Record<string, string>
    expect(cfg.aws_waf_token).toBeUndefined()
    expect(cfg.keep).toBe("this")
  })
})
