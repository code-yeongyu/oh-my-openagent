import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { CLAUDE_CODE_PIN_FILE, createClaudeCodeComponent } from "./index"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(tmpdir(), "omo-claude-code-login-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

type Handler = (payload: unknown, ctx?: unknown) => unknown
const noopLogger = { info() {}, warn() {}, error() {} }

async function harness(options: { gateFetch?: Promise<void> } = {}) {
  const runtimeDir = temp()
  const bytes = await new Bun.Archive({ "package/claude": "#!/bin/sh\n" }, { compress: "gzip" }).bytes()
  writeFileSync(join(runtimeDir, CLAUDE_CODE_PIN_FILE), JSON.stringify({
    name: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    version: "0.3.284",
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    claudeCodeVersion: "2.1.284",
  }))
  const handlers = new Map<string, Handler>()
  const requests: string[] = []
  const env: NodeJS.ProcessEnv = {}
  const component = createClaudeCodeComponent({
    env,
    execPath: join(runtimeDir, "omo"),
    platform: "darwin",
    which: () => null,
    fetch: (async (input: string | URL | Request) => {
      requests.push(String(input))
      await options.gateFetch
      return new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } })
    }) as typeof globalThis.fetch,
  })
  const pi = { on: (event: string, handler: Handler) => { handlers.set(event, handler) } } as unknown as SenpiExtensionAPI
  await component.register(pi, { logger: noopLogger, config: { getFlag: () => undefined } } as ComponentContext)
  const progress: string[] = []
  const loginStart = (provider: string, signal: AbortSignal = new AbortController().signal) => {
    const handler = handlers.get("provider_login_start")
    expect(handler).toBeDefined()
    return handler?.({ type: "provider_login_start", provider, signal, progress: (message: string) => progress.push(message) })
  }
  const cached = join(runtimeDir, "claude-code", "@anthropic-ai+claude-agent-sdk-darwin-arm64", "0.3.284", "claude")
  return { env, requests, progress, loginStart, cached }
}

describe("claude-code component on provider_login_start", () => {
  test("#given a machine without claude #when a Claude sign-in starts #then the pinned binary is acquired before the login proceeds, with progress", async () => {
    const h = await harness()
    await h.loginStart("anthropic-subscription")
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBe(h.cached)
    expect(existsSync(h.cached) && statSync(h.cached).size > 0).toBe(true)
    expect(h.requests).toHaveLength(1)
    expect(h.progress.some((line) => /^Downloading Claude Code 2\.1\.284: \d+% of \d+ MB$/.test(line))).toBe(true)
  })

  test("#given a sign-in for another provider #when it starts #then nothing is downloaded", async () => {
    const h = await harness()
    await h.loginStart("openai-codex")
    expect(h.requests).toEqual([])
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })

  test("#given a download in flight #when the sign-in is cancelled #then the handler stops waiting and the shared download still finishes", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = await harness({ gateFetch: gate })
    const controller = new AbortController()
    let settled = false
    const pending = Promise.resolve(h.loginStart("anthropic-subscription", controller.signal)).then(() => { settled = true })
    expect(h.requests).toHaveLength(1)
    controller.abort()
    await pending
    expect(settled).toBe(true)
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
    release()
    await h.loginStart("anthropic-subscription")
    expect(h.requests).toHaveLength(1)
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBe(h.cached)
  })
})
