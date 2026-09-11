import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export interface BuiltinMcpsComponentOptions {
  readonly env?: Record<string, string | undefined>
}

const BUILTIN_MCPS_COMPONENT_NAME = "builtin-mcps"
const CONTEXT7_SERVER_NAME = "context7"
const CONTEXT7_URL = "https://mcp.context7.com/mcp"
const CONTEXT7_API_KEY_ENV = "CONTEXT7_API_KEY"
const GREP_APP_SERVER_NAME = "grep_app"
const GREP_APP_URL = "https://mcp.grep.app"

export function createBuiltinMcpsComponent(options: BuiltinMcpsComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env

  return {
    name: BUILTIN_MCPS_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      if (typeof pi.registerMcpServer !== "function") {
        ctx.logger.info("omo-senpi builtin-mcps skipped: senpi ExtensionAPI does not expose registerMcpServer", {
          component: BUILTIN_MCPS_COMPONENT_NAME,
        })
        return
      }

      pi.registerMcpServer(CONTEXT7_SERVER_NAME, createContext7Declaration(env))
      pi.registerMcpServer(GREP_APP_SERVER_NAME, {
        type: "http",
        url: GREP_APP_URL,
        enabled: true,
        auth: false,
        lifecycle: "lazy",
      })
    },
  }
}

function createContext7Declaration(env: Record<string, string | undefined>): Record<string, unknown> {
  // The key stays in the environment: senpi reads `bearerTokenEnv` at connect time, so a literal
  // Authorization header would only copy the secret into config dumps, diagnostics, and logs.
  const authenticated = hasContext7ApiKey(env[CONTEXT7_API_KEY_ENV])

  return {
    type: "http",
    url: CONTEXT7_URL,
    enabled: true,
    ...(authenticated ? { auth: "bearer", bearerTokenEnv: CONTEXT7_API_KEY_ENV } : { auth: false }),
    lifecycle: "lazy",
  }
}

// Mirrors the OpenCode edition's placeholder normalization (packages/omo-opencode/src/mcp/context7.ts):
// copied `.env` templates carry `<YOUR_API_KEY>`-style values, and sending one as a bearer token turns
// the anonymous-but-working server into an authentication failure.
function hasContext7ApiKey(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase().replace(/[<>"'`]/g, "").replace(/[\s_-]+/g, " ")
  return normalized.length > 0 && normalized !== "your api key"
}
