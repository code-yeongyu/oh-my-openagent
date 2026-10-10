import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { mkdirSync } from "node:fs"
import { applyCachedClaudeCode, CLAUDE_CODE_PIN_FILE, CLAUDE_CODE_STATUS_KEY, createClaudeCodeComponent } from "./index"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(tmpdir(), "omo-claude-code-component-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

type Handler = (payload: unknown, ctx?: unknown) => unknown
const noopLogger = { info() {}, warn() {}, error() {} }

async function harness(options: { pin: boolean; env?: NodeJS.ProcessEnv; claudeOnPath?: string; packageDirEnv?: boolean }) {
  const runtimeDir = temp()
  const bytes = await new Bun.Archive({ "package/claude": "#!/bin/sh\n" }, { compress: "gzip" }).bytes()
  if (options.pin) {
    writeFileSync(join(runtimeDir, CLAUDE_CODE_PIN_FILE), JSON.stringify({
      name: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
      version: "0.3.284",
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      claudeCodeVersion: "2.1.284",
    }))
  }
  const handlers = new Map<string, Handler>()
  const requests: string[] = []
  const env: NodeJS.ProcessEnv = options.env ?? {}
  if (options.packageDirEnv) env.OMO_PACKAGE_DIR = runtimeDir
  const component = createClaudeCodeComponent({
    env,
    execPath: options.packageDirEnv ? join(temp(), "omo") : join(runtimeDir, "omo"),
    platform: "darwin",
    which: () => options.claudeOnPath ?? null,
    fetch: (async (input: string | URL | Request) => { requests.push(String(input)); return new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } }) }) as typeof globalThis.fetch,
  })
  const pi = { on: (event: string, handler: Handler) => { handlers.set(event, handler) } } as unknown as SenpiExtensionAPI
  await component.register(pi, { logger: noopLogger, config: { getFlag: () => undefined } } as ComponentContext)
  const notices: string[] = []
  const statuses: Array<string | undefined> = []
  const ui = { notify: (message: string) => notices.push(message), setStatus: (key: string, text: string | undefined) => { if (key === CLAUDE_CODE_STATUS_KEY) statuses.push(text) } }
  const turn = (provider: string, payload: unknown = {}) => handlers.get("before_agent_start")?.(payload, { model: { provider }, ui })
  const input = (provider: string) => handlers.get("input")?.({ type: "input", text: "hi" }, { model: { provider }, ui })
  return { env, requests, notices, statuses, turn, input, handlers, runtimeDir }
}

describe("claude-code component", () => {
  test("#given a standalone runtime #when an anthropic-subscription turn starts #then the pinned executable is acquired before the turn and handed to the engine", async () => {
    const h = await harness({ pin: true })
    await h.turn("anthropic-subscription")
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBe(join(h.runtimeDir, "claude-code", "@anthropic-ai+claude-agent-sdk-darwin-arm64", "0.3.284", "claude"))
    expect(h.requests).toHaveLength(1)
    expect(h.notices).toHaveLength(1)
    await h.turn("anthropic-subscription")
    expect(h.requests).toHaveLength(1)
  })

  test("#given a user prompt #when its input event fires, before senpi's auth check #then the executable is acquired there with a progress line", async () => {
    const h = await harness({ pin: true })
    await h.input("anthropic-subscription")
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBe(join(h.runtimeDir, "claude-code", "@anthropic-ai+claude-agent-sdk-darwin-arm64", "0.3.284", "claude"))
    expect(h.statuses.at(0)).toMatch(/^Downloading Claude Code 2\.1\.284: \d+% of \d+ MB$/)
    expect(h.statuses.at(-1)).toBeUndefined()
    await h.turn("anthropic-subscription")
    expect(h.requests).toHaveLength(1)
  })

  test("#given the prompt-cache preview #when before_agent_start fires #then nothing is downloaded", async () => {
    const h = await harness({ pin: true })
    await h.turn("anthropic-subscription", { preview: true })
    expect(h.requests).toEqual([])
  })

  test("#given the process still runs from the download path #when OMO_PACKAGE_DIR names the provisioned runtime #then the pin there is used", async () => {
    const h = await harness({ pin: true, packageDirEnv: true })
    await h.input("anthropic-subscription")
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBe(join(h.runtimeDir, "claude-code", "@anthropic-ai+claude-agent-sdk-darwin-arm64", "0.3.284", "claude"))
  })

  test("#given a turn on another provider #when it starts #then nothing is downloaded", async () => {
    const h = await harness({ pin: true })
    await h.turn("openai")
    expect(h.requests).toEqual([])
    expect(h.env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })

  test("#given an npm install without a pin #when registered #then the component stays out of the way", async () => {
    const h = await harness({ pin: false })
    expect(h.handlers.size).toBe(0)
  })

  test("#given claude on PATH or an explicit CLAUDE_CODE_EXECUTABLE #when a Claude turn starts #then the user's executable wins and nothing is downloaded", async () => {
    const onPath = await harness({ pin: true, claudeOnPath: "/usr/local/bin/claude" })
    await onPath.turn("anthropic-subscription")
    expect(onPath.requests).toEqual([])
    const explicit = await harness({ pin: true, env: { CLAUDE_CODE_EXECUTABLE: "/opt/claude" } })
    await explicit.turn("anthropic-subscription")
    expect(explicit.requests).toEqual([])
    expect(explicit.env.CLAUDE_CODE_EXECUTABLE).toBe("/opt/claude")
  })
})

describe("applyCachedClaudeCode", () => {
  function runtimeWithCache(): { runtimeDir: string; cached: string } {
    const runtimeDir = temp()
    writeFileSync(join(runtimeDir, CLAUDE_CODE_PIN_FILE), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk-darwin-arm64", version: "0.3.284", integrity: "sha512-x" }))
    const dir = join(runtimeDir, "claude-code", "@anthropic-ai+claude-agent-sdk-darwin-arm64", "0.3.284")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n")
    return { runtimeDir, cached: join(dir, "claude") }
  }

  test("#given an executable downloaded by an earlier session #when the compiled launcher starts #then the engine is pointed at it", () => {
    const { runtimeDir, cached } = runtimeWithCache()
    const env: NodeJS.ProcessEnv = {}
    applyCachedClaudeCode(env, runtimeDir, "darwin", () => null)
    expect(env.CLAUDE_CODE_EXECUTABLE).toBe(cached)
  })

  test("#given claude on PATH, an explicit override, or nothing downloaded yet #when the launcher starts #then CLAUDE_CODE_EXECUTABLE is left alone", () => {
    const { runtimeDir } = runtimeWithCache()
    const onPath: NodeJS.ProcessEnv = {}
    applyCachedClaudeCode(onPath, runtimeDir, "darwin", () => "/usr/local/bin/claude")
    expect(onPath.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
    const explicit: NodeJS.ProcessEnv = { CLAUDE_CODE_EXECUTABLE: "/opt/claude" }
    applyCachedClaudeCode(explicit, runtimeDir, "darwin", () => null)
    expect(explicit.CLAUDE_CODE_EXECUTABLE).toBe("/opt/claude")
    const fresh: NodeJS.ProcessEnv = {}
    applyCachedClaudeCode(fresh, temp(), "darwin", () => null)
    expect(fresh.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })
})
