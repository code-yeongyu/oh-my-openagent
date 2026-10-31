import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { MODEL_ROUTING_RESOLVE_RPC_METHOD, registerModelRoutingRpc, type ModelRoutingRpcDeps } from "./model-routing-rpc"
import type { ModelRoutingRow } from "./model-routing-rows"

// Retention: protocol contract with sisyphuslabs/omo-desktop-app#4507 (method name, answer envelope, typed refusals).

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const MODELS: readonly SenpiModelPort[] = [
  { provider: "user-lab", id: "second-model" },
  { provider: "anthropic", id: "claude-opus-5-5" },
]
const liveRegistry = {
  getAvailable: () => MODELS,
  find: (provider: string, modelId: string) => MODELS.find((model) => model.provider === provider && model.id === modelId),
}

function rpcHost() {
  const handlers = new Map<string, (data: unknown) => unknown>()
  const pi = { rpc: { emit: () => {}, handle: (name: string, handler: (data: unknown) => unknown) => handlers.set(name, handler) } }
  return { pi: pi as unknown as SenpiExtensionAPI, handlers }
}

function project(configText?: string): { readonly home: string; readonly cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "omo-model-routing-"))
  roots.push(home)
  const cwd = join(home, "project")
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  if (configText !== undefined) writeFileSync(join(cwd, ".omo", "omo.jsonc"), configText)
  return { home, cwd }
}

function deps(home: string, cwd: string, overrides: Partial<ModelRoutingRpcDeps> = {}): ModelRoutingRpcDeps {
  return {
    cwd: () => cwd,
    loadConfig: (projectDir) => loadSenpiOmoConfig({ cwd: projectDir, env: { HOME: home } }),
    registry: () => liveRegistry,
    ...overrides,
  }
}

async function ask(input: ModelRoutingRpcDeps): Promise<unknown> {
  const host = rpcHost()
  registerModelRoutingRpc(host.pi, input)
  const handler = host.handlers.get(MODEL_ROUTING_RESOLVE_RPC_METHOD)
  if (handler === undefined) throw new Error(`${MODEL_ROUTING_RESOLVE_RPC_METHOD} was not registered`)
  return await handler(undefined)
}

function rowsOf(answer: unknown): readonly ModelRoutingRow[] {
  expect(answer).toMatchObject({ schemaVersion: 1 })
  return (answer as { readonly rows: readonly ModelRoutingRow[] }).rows
}

function tree(root: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = join(root, name)
    const stat = statSync(path)
    entries[name] = stat.isDirectory() ? `dir ${stat.mtimeMs}` : `${stat.mtimeMs} ${readFileSync(path, "base64")}`
  }
  return entries
}

describe("omo.modelRouting.resolve", () => {
  test("#given the desktop's method name #when registered #then it is the exact name the desktop calls", () => {
    expect(MODEL_ROUTING_RESOLVE_RPC_METHOD).toBe("omo.modelRouting.resolve")
  })

  test("#given a project config with a category override and the retired deep key #when asked #then rows come from that project's merged config", async () => {
    const { home, cwd } = project(`{
      // the retired name loads as deep-low
      "categories": { "quick": { "model": "user-lab/second-model" }, "deep": { "model": "user-lab/second-model" } }
    }`)
    const rows = rowsOf(await ask(deps(home, cwd)))
    expect(rows.find((row) => row.kind === "category" && row.name === "quick")).toMatchObject({ effective: "user-lab/second-model", source: "override" })
    expect(rows.find((row) => row.kind === "category" && row.name === "deep-low")).toMatchObject({ effective: "user-lab/second-model", source: "override" })
    expect(rows.some((row) => row.name === "deep")).toBe(false)
    expect(rows.some((row) => row.kind === "agent")).toBe(true)
  })

  test("#given a project #when asked twice #then nothing on disk changes and both answers are identical", async () => {
    const { home, cwd } = project(`{ "categories": { "quick": { "model": "user-lab/second-model" } } }`)
    const before = tree(home)
    const first = await ask(deps(home, cwd))
    const second = await ask(deps(home, cwd))
    expect(tree(home)).toEqual(before)
    expect(second).toEqual(first)
  })

  test("#given a session cwd that does not exist #when asked #then it answers the typed cwd_unavailable error", async () => {
    const { home, cwd } = project()
    expect(await ask(deps(home, join(cwd, "gone")))).toMatchObject({ kind: "error", code: "cwd_unavailable" })
  })

  test("#given an unparseable project config #when asked #then it answers the typed config_invalid error instead of guessed rows", async () => {
    const { home, cwd } = project(`{ "categories": { "quick": `)
    expect(await ask(deps(home, cwd))).toMatchObject({ kind: "error", code: "config_invalid" })
  })

  test("#given a session with no model registry yet #when asked #then it answers the typed registry_unavailable error", async () => {
    const { home, cwd } = project()
    expect(await ask(deps(home, cwd, { registry: () => undefined }))).toMatchObject({ kind: "error", code: "registry_unavailable" })
  })

  test("#given a host without extension request handlers #when registered #then registration is a no-op", () => {
    const { home, cwd } = project()
    expect(() => registerModelRoutingRpc({ rpc: { emit: () => {} } } as unknown as SenpiExtensionAPI, deps(home, cwd))).not.toThrow()
  })
})
