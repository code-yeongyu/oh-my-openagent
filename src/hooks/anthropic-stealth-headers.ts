/**
 * Claude Code stealth headers for Anthropic OAuth requests.
 *
 * When using an OAuth token (sk-ant-oat*), Anthropic's API checks for
 * Claude Code's request signature to apply the correct billing relationship
 * and rate-limit tier (e.g. Max 20x). Without these headers, the request
 * is treated as a bare OAuth call and gets the base-tier rate limits.
 *
 * This hook implements the same header set that OMP (Oh-My-Pi) uses,
 * matching the Claude Code client signature exactly.
 */


import type { ProviderContext } from "@opencode-ai/plugin"
import type { Model, UserMessage } from "@opencode-ai/sdk"
import * as crypto from "node:crypto"

// ─────────────────────────────────────────────────────────────────────────────
// Constants — must match the versions OMP / Claude Code actually sends
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_CODE_VERSION = "2.1.63"

const STAINLESS_HEADERS: Record<string, string> = {
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": `v${process.versions?.node ?? "24.3.0"}`,
  "X-Stainless-Package-Version": "0.74.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapArch(process.arch),
  "X-Stainless-Os": mapOs(process.platform),
  "X-Stainless-Timeout": "600",
}

const CLAUDE_CODE_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapOs(platform: string): string {
  switch (platform) {
    case "darwin":
      return "MacOS"
    case "win32":
      return "Windows"
    case "linux":
      return "Linux"
    case "freebsd":
      return "FreeBSD"
    default:
      return `Other::${platform}`
  }
}

function mapArch(arch: string): string {
  switch (arch) {
    case "x64":
      return "x64"
    case "arm64":
      return "arm64"
    case "ia32":
    case "x86":
      return "x86"
    default:
      return `other::${arch}`
  }
}

export function isAnthropicOAuthToken(key: string | undefined): boolean {
  return typeof key === "string" && key.includes("sk-ant-oat")
}

/**
 * Merge beta header values, deduplicating and preserving order.
 */
function mergeBetas(existing: string | undefined, additions: string[]): string {
  const seen = new Set<string>()
  const result: string[] = []
  const all = [...(existing?.split(",") ?? []), ...additions]
  for (const b of all) {
    const trimmed = b.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result.join(",")
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing header — injected into the system prompt by the params hook,
// but the formula is here for co-location with the other stealth constants.
// ─────────────────────────────────────────────────────────────────────────────

const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:"

export function createBillingHeaderText(payload: unknown): string {
  const payloadJson = JSON.stringify(payload) ?? ""
  const cch = crypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 5)
  const randomBytes = new Uint8Array(2)
  crypto.getRandomValues(randomBytes)
  const buildHash = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 3)
  return `${BILLING_HEADER_PREFIX} cc_version=${CLAUDE_CODE_VERSION}.${buildHash}; cc_entrypoint=cli; cch=${cch};`
}

export const CLAUDE_CODE_SYSTEM_INSTRUCTION =
  "You are a Claude agent, built on Anthropic's Claude Agent SDK."

// ─────────────────────────────────────────────────────────────────────────────
// Cloaking metadata user_id
// ─────────────────────────────────────────────────────────────────────────────

export function generateCloakingUserId(): string {
  const userHash = crypto.randomBytes(32).toString("hex")
  const accountId = crypto.randomUUID().toLowerCase()
  const sessionId = crypto.randomUUID().toLowerCase()
  return `user_${userHash}_account_${accountId}_session_${sessionId}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool prefix — OMP prefixes all non-builtin tool names with "proxy_"
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"])
export const TOOL_PREFIX = "proxy_"

export function applyToolPrefix(name: string): string {
  if (BUILTIN_TOOL_NAMES.has(name.toLowerCase())) return name
  if (name.toLowerCase().startsWith(TOOL_PREFIX)) return name
  return `${TOOL_PREFIX}${name}`
}

export function stripToolPrefix(name: string): string {
  if (!name.toLowerCase().startsWith(TOOL_PREFIX)) return name
  return name.slice(TOOL_PREFIX.length)
}

// ─────────────────────────────────────────────────────────────────────────────
// chat.headers hook implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injects Claude Code stealth headers into Anthropic API requests when
 * using an OAuth token. This is what activates the Max 20x rate tier.
 */
export async function anthropicStealthHeadersHook(
  input: {
    sessionID: string
    agent: string
    model: Model
    provider: ProviderContext
    message: UserMessage
  },
  output: { headers: Record<string, string> },
): Promise<void> {
  // Only apply to anthropic provider
  if (input.model.providerID !== "anthropic") return

  // Check if the current auth key is an OAuth token
  const apiKey =
    output.headers["Authorization"]?.replace("Bearer ", "") ||
    output.headers["x-api-key"] ||
    input.provider.options?.apiKey

  if (!isAnthropicOAuthToken(apiKey)) return

  // Inject stealth headers
  Object.assign(output.headers, STAINLESS_HEADERS)

  // Set proper User-Agent
  output.headers["User-Agent"] = `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`

  // Use Bearer auth, not X-Api-Key
  if (output.headers["x-api-key"]) {
    output.headers["Authorization"] = `Bearer ${output.headers["x-api-key"]}`
    delete output.headers["x-api-key"]
  }

  // Merge Claude Code betas into existing Anthropic-Beta header
  output.headers["Anthropic-Beta"] = mergeBetas(output.headers["Anthropic-Beta"], CLAUDE_CODE_BETAS)

  // Required shared headers
  output.headers["Anthropic-Dangerous-Direct-Browser-Access"] = "true"
  output.headers["X-App"] = "cli"
}
