import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export type CookieCapturer = (url: string) => Promise<Record<string, string>>

let cookieCapturer: CookieCapturer | null = null

export function __setCookieCapturerForTest(fn: CookieCapturer | null): void {
  cookieCapturer = fn
}

async function defaultCapture(url: string): Promise<Record<string, string>> {
  const { createBrowserPool } = await import("../../mcp/idm-browser/pool")
  const pool = createBrowserPool({ maxConcurrent: 1, idleTimeoutMs: 60_000, engineOptions: { engine: "camoufox", headless: true } })
  const session = await pool.acquire()
  try {
    await session.page.goto(url, { waitUntil: "networkidle", timeout: 60_000 })
    const captured = await session.context.cookies(url)
    const out: Record<string, string> = {}
    for (const c of captured) out[c.name] = c.value
    return out
  } finally {
    await pool.shutdown().catch(() => undefined)
  }
}

const DESCRIPTION = `Bootstrap a registered provider's cookie-based auth by visiting its base URL via the Camoufox browser, capturing required cookies (e.g. aws-waf-token for deepseek_web), and persisting them into provider auth_config. Required once per deepseek_web provider before probe_run will succeed against AWS WAF.`

export function createProbeProviderBootstrapTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      provider_id: tool.schema.string().describe("Provider id to bootstrap"),
    },
    async execute(args) {
      try {
        const creds = ctx.store.getProvider(args.provider_id)
        if (!creds) return `[ERROR] provider not found: ${args.provider_id}`
        if (creds.provider_type !== "deepseek_web") {
          return `[ERROR] probe_provider_bootstrap currently supports provider_type 'deepseek_web' only; got '${creds.provider_type}'`
        }
        const capture = cookieCapturer ?? defaultCapture
        const cookies = await capture(creds.base_url)
        const wafToken = cookies["aws-waf-token"]
        if (!wafToken) {
          return JSON.stringify({
            provider_id: args.provider_id,
            success: false,
            cookies_captured: Object.keys(cookies),
            message: "navigation completed but no aws-waf-token cookie was set; the WAF may not be challenging this origin or the page failed to clear the challenge",
          })
        }
        const merged = mergeAuthConfig(creds.auth_config, { aws_waf_token: wafToken })
        ctx.store.updateProviderAuthConfig(args.provider_id, merged as Record<string, unknown>)
        return JSON.stringify({
          provider_id: args.provider_id,
          success: true,
          cookies_captured: Object.keys(cookies),
          persisted_field: "aws_waf_token",
          message: "aws-waf-token captured and persisted to auth_config",
        })
      } catch (err) {
        return `[ERROR] probe_provider_bootstrap failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}

function mergeAuthConfig(currentJson: string, additions: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(currentJson) as Record<string, unknown>
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v
    }
  } catch {
    void 0
  }
  for (const [k, v] of Object.entries(additions)) out[k] = v
  return out
}
