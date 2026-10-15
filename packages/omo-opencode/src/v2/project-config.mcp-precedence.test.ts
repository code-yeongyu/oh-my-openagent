/// <reference types="bun-types" />
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { projectV1Surface } from "./project-config"

type Server = Record<string, unknown>
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function projection(fallbacks: Record<string, Server>) {
  const directory = mkdtempSync(join(tmpdir(), "omo-mcp-precedence-"))
  directories.push(directory)
  let transform: (editor: object) => void = () => undefined
  const ctx = {
    agent: { transform: async (fn: (editor: object) => void) => fn({}) },
    tool: { transform: async (fn: (editor: object) => void) => fn({}) },
    command: { transform: async (fn: (editor: object) => void) => fn({}) },
    mcp: { transform: async (fn: (editor: object) => void) => { transform = fn } },
  } as unknown as Parameters<typeof projectV1Surface>[0]["ctx"]
  await projectV1Surface({ ctx, directory, agentDirectory: join(directory, "agents"), config: { mcp: fallbacks }, tools: {} })
  // Native ConfigMcpPlugin is a pre-plugin: each registry replay supplies its
  // current layered host entries before package-plugin transforms execute.
  return (host: Record<string, Server>) => {
    const registry = new Map(Object.entries(host))
    transform({ get: (name: string) => registry.get(name), set: (name: string, value: Server) => registry.set(name, value) })
    return registry
  }
}

const names = ["context7", "lsp", "websearch", "grep_app"]
const builtins = Object.fromEntries(names.map((name) => [name, { type: "remote", url: `https://builtin.invalid/${name}`, enabled: true }]))
const gateway = (name: string, disabled = false): Server => ({ type: "remote", url: `http://127.0.0.1:9650/mcp/${name}`, disabled, headers: { "x-test-marker": "host-owned" }, timeout: { execution: 1234 } })

test("user gateway definitions win intact over all four OMO built-in names", async () => {
  const replay = await projection(builtins)
  const host = Object.fromEntries(names.map((name) => [name, gateway(name)]))
  const registry = replay(host)
  for (const name of names) expect(registry.get(name)).toBe(host[name])
  expect(registry.size).toBe(4)
})

test("explicit user-disabled entries remain disabled, never replaced by enabled built-ins", async () => {
  const replay = await projection(builtins)
  const host = { context7: gateway("context7", true), lsp: gateway("lsp", true) }
  const registry = replay(host)
  expect(registry.get("context7")).toBe(host.context7)
  expect(registry.get("lsp")).toBe(host.lsp)
  expect(registry.get("websearch")?.url).toBe("https://builtin.invalid/websearch")
})

test("built-ins fill only gaps and registry replay observes host add, update and removal", async () => {
  const replay = await projection(builtins)
  expect(replay({}).get("context7")?.url).toBe("https://builtin.invalid/context7")
  const first = gateway("context7")
  expect(replay({ context7: first }).get("context7")).toBe(first)
  const updated = { ...first, url: "http://127.0.0.1:9650/mcp/context7-updated" }
  expect(replay({ context7: updated }).get("context7")).toBe(updated)
  expect(replay({}).get("context7")?.url).toBe("https://builtin.invalid/context7")
})

test("temporary grep-app host alias suppresses OMO's direct grep_app, then original name wins after rename", async () => {
  const replay = await projection(builtins)
  const host = gateway("grep-app")
  const before = replay({ "grep-app": host })
  expect(before.get("grep-app")).toBe(host)
  expect(before.has("grep_app")).toBe(false)
  const after = replay({ grep_app: host })
  expect(after.get("grep_app")).toBe(host)
  expect(after.has("grep-app")).toBe(false)
})

test("unrelated names are not normalized or removed, including explicitly configured pairs", async () => {
  const replay = await projection({ custom_name: { type: "remote", url: "https://builtin.invalid/custom" }, ...builtins })
  const host = { "custom-name": gateway("custom-name"), "grep-app": gateway("grep-app"), grep_app: gateway("grep_app") }
  const registry = replay(host)
  expect(registry.has("custom_name")).toBe(true)
  for (const name of Object.keys(host)) expect(registry.get(name)).toBe(host[name as keyof typeof host])
})
