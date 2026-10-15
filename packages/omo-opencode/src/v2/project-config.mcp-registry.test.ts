/// <reference types="bun-types" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { projectV1Surface } from "./project-config"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function project(disabled: Record<string, boolean>) {
  const directory = mkdtempSync(join(tmpdir(), "omo-mcp-registry-"))
  directories.push(directory)
  type Entry = { id: string; name: string; options?: { namespace: string } }
  const registry = new Map<string, Entry>([
    ["grep_app_searchGitHub", { id: "grep_app_searchGitHub", name: "searchGitHub", options: { namespace: "grep_app" } }],
    ["custom_lookup", { id: "custom_lookup", name: "lookup", options: { namespace: "custom" } }],
    ["task_external_run", { id: "task_external_run", name: "run", options: { namespace: "task_external" } }],
    ["shell", { id: "shell", name: "shell" }],
    ["plugin_hidden", { id: "plugin_hidden", name: "plugin_hidden" }],
  ])
  const ctx = {
    agent: { transform: async (fn: (editor: object) => void) => fn({ get: () => undefined }) },
    tool: { transform: async (fn: (editor: object) => void) => fn({
      list: () => [...registry.values()],
      add: (tool: { name: string }) => registry.set(tool.name, { id: tool.name, name: tool.name }),
      remove: (id: string) => registry.delete(id),
    }) },
    command: { transform: async (fn: (editor: object) => void) => fn({}) },
    mcp: { transform: async (fn: (editor: object) => void) => fn({ get: () => undefined, set: () => undefined }) },
  } as unknown as Parameters<typeof projectV1Surface>[0]["ctx"]
  await projectV1Surface({
    ctx, directory, agentDirectory: join(directory, "agents"),
    config: {
      tools: disabled,
      mcp: Object.fromEntries(["grep_app", "custom", "task_external"].map((name) => [name, { type: "remote", url: "https://example.invalid/mcp" }])),
      agent: { librarian: { prompt: "Search", permission: { "grep_app_*": "allow" } } },
    },
    tools: { plugin_hidden: { description: "Owned plugin tool", args: {}, execute: async () => "ok" } },
  })
  return { registry, agent: readFileSync(join(directory, "agents/librarian.md"), "utf8") }
}

test("V1 wildcard defaults cannot delete shared MCP tools or the librarian's registration", async () => {
  const { registry, agent } = await project({ "grep_app_*": false, "task_*": false, "plugin_*": false, shell: false })
  expect(registry.has("grep_app_searchGitHub")).toBe(true)
  expect(registry.has("task_external_run")).toBe(true)
  expect(registry.has("custom_lookup")).toBe(true)
  expect(registry.has("plugin_hidden")).toBe(false)
  expect(registry.has("shell")).toBe(false)
  expect(agent).toContain('action: "grep_app_*"')
  expect(agent).toContain("effect: allow")
})

test("exact legacy tool defaults also leave MCP registration to the host", async () => {
  const { registry } = await project({ grep_app_searchGitHub: false, custom_lookup: false, plugin_hidden: false })
  expect(registry.has("grep_app_searchGitHub")).toBe(true)
  expect(registry.has("custom_lookup")).toBe(true)
  expect(registry.has("plugin_hidden")).toBe(false)
})
