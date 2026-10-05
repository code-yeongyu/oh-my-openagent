import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, lstat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginAgents } from "./link-cached-plugin-agents"
import { ensureAgentConfig } from "./codex-config-agents"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lazycodex-default-"))
  roots.push(root)
  const codexHome = join(root, "codex")
  const pluginRoot = join(root, "plugin")
  const agents = join(pluginRoot, "components", "ultrawork", "agents")
  await mkdir(agents, { recursive: true })
  await mkdir(join(codexHome, "agents"), { recursive: true })
  const worker = join(agents, "lazycodex-worker-medium.toml")
  await writeFile(worker, 'name = "lazycodex-worker-medium"\nmodel = "test-model"\nmodel_reasoning_effort = "high"\ndeveloper_instructions = "worker instructions"\n')
  return { codexHome, pluginRoot, worker, target: join(codexHome, "agents", "default.toml") }
}

describe("#given a bundled medium worker #when installing the fallback role", () => {
  test("installs an internally named default with worker settings and registers its file", async () => {
    const input = await fixture()
    const links = await linkCachedPluginAgents(input)
    const role = Bun.TOML.parse(await readFile(input.target, "utf8"))
    expect(role).toEqual({ name: "default", model: "test-model", model_reasoning_effort: "high", developer_instructions: "worker instructions" })
    const fallback = links.find((link) => link.name === "default.toml")
    expect(fallback?.path).toBe(input.target)
    const config = ensureAgentConfig("", { name: "default", configFile: "./agents/default.toml" })
    expect(Bun.TOML.parse(config)).toEqual({ agents: { default: { config_file: "./agents/default.toml" } } })
  })
  test("is idempotent and upgrades an unchanged owned default", async () => {
    const input = await fixture()
    await linkCachedPluginAgents(input)
    const first = await readFile(input.target, "utf8")
    await linkCachedPluginAgents(input)
    expect(await readFile(input.target, "utf8")).toBe(first)
    await writeFile(input.worker, 'name = "lazycodex-worker-medium"\nmodel = "next-model"\n')
    await linkCachedPluginAgents(input)
    expect(Bun.TOML.parse(await readFile(input.target, "utf8"))).toHaveProperty("model", "next-model")
  })
  test("preserves a user's default and fails loudly", async () => {
    const input = await fixture()
    const custom = 'name = "default"\nmodel = "custom"\n'
    await writeFile(input.target, custom)
    await expect(linkCachedPluginAgents(input)).rejects.toThrow("default")
    expect(await readFile(input.target, "utf8")).toBe(custom)
  })
  test("preserves a customized previously owned default", async () => {
    const input = await fixture()
    await linkCachedPluginAgents(input)
    await writeFile(input.target, 'name = "default"\nmodel = "custom"\n')
    await expect(linkCachedPluginAgents(input)).rejects.toThrow("default")
    expect(Bun.TOML.parse(await readFile(input.target, "utf8"))).toHaveProperty("model", "custom")
  })
  test("opt-out skips fresh installation and removes only unchanged managed defaults", async () => {
    const input = await fixture()
    await linkCachedPluginAgents({ ...input, defaultRoleEnabled: false })
    expect(await Bun.file(input.target).exists()).toBe(false)
    await linkCachedPluginAgents(input)
    await writeFile(join(input.codexHome, "config.toml"), '[agents.default]\nconfig_file = "./agents/default.toml"\n\n[agents.custom]\nconfig_file = "custom.toml"\n')
    await linkCachedPluginAgents({ ...input, defaultRoleEnabled: false })
    expect(await Bun.file(input.target).exists()).toBe(false)
    expect(Bun.TOML.parse(await readFile(join(input.codexHome, "config.toml"), "utf8"))).toEqual({ agents: { custom: { config_file: "custom.toml" } } })
    await writeFile(input.target, 'name = "default"\nmodel = "custom"\n')
    await linkCachedPluginAgents({ ...input, defaultRoleEnabled: false })
    expect(Bun.TOML.parse(await readFile(input.target, "utf8"))).toHaveProperty("model", "custom")
  })
  test("preserves a dangling user symlink without writing its target", async () => {
    const input = await fixture()
    const destination = join(input.codexHome, "user-default.toml")
    await symlink(destination, input.target)
    await expect(linkCachedPluginAgents(input)).rejects.toThrow("default")
    expect((await lstat(input.target)).isSymbolicLink()).toBe(true)
    expect(await Bun.file(destination).exists()).toBe(false)
  })
  test("preserves foreign registration without introducing another default", async () => {
    const input = await fixture()
    const config = '[agents.default]\nconfig_file = "/custom/default.toml"\n'
    await writeFile(join(input.codexHome, "config.toml"), config)
    await expect(linkCachedPluginAgents(input)).rejects.toThrow("default")
    expect(await readFile(join(input.codexHome, "config.toml"), "utf8")).toBe(config)
    expect(await Bun.file(input.target).exists()).toBe(false)
  })
})
