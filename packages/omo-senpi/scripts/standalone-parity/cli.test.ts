/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runStandaloneParityCli } from "./cli"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone parity CLI", () => {
  test("#given compatible personal roots #when generate runs in staging-only mode #then writes a verified beta staging payload", async () => {
    // given
    const home = await mkdtemp(join(tmpdir(), "omo-standalone-cli-home-"))
    const betaRoot = await mkdtemp(join(tmpdir(), "omo-standalone-cli-beta-"))
    roots.push(home, betaRoot)
    await mkdir(join(home, ".config", "opencode", "skills", "personal"), { recursive: true })
    await mkdir(join(home, ".config", "opencode", "commands"), { recursive: true })
    await mkdir(join(home, ".omo"), { recursive: true })
    await mkdir(join(betaRoot, "home", ".omo", "agent"), { recursive: true })
    const openVikingRoot = join(home, ".cache", "opencode", "packages", "@openviking", "opencode-plugin@0.2.4", "node_modules", "@openviking", "opencode-plugin")
    await mkdir(join(openVikingRoot, "servers"), { recursive: true })
    await mkdir(join(home, ".openviking"), { recursive: true })
    await writeFile(join(home, ".config", "opencode", "skills", "personal", "SKILL.md"), "---\nname: personal\ndescription: personal\n---\nbody")
    await writeFile(join(home, ".config", "opencode", "commands", "hello.md"), "---\ndescription: hello\n---\nhello")
    await writeFile(join(home, ".config", "opencode", "AGENTS.md"), "# Global")
    await writeFile(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ plugin: ["@openviking/opencode-plugin@0.2.4"] }))
    await writeFile(join(openVikingRoot, "package.json"), JSON.stringify({ name: "@openviking/opencode-plugin", version: "0.2.4" }))
    await writeFile(join(openVikingRoot, "servers", "mcp-proxy.mjs"), "process.stdin.resume()\n")
    await writeFile(join(home, ".openviking", "ovcli.conf"), JSON.stringify({ api_key: "must-not-be-copied" }))
    await writeFile(join(home, ".omo", "omo.jsonc"), JSON.stringify({ "[opencode]": {
      default_run_agent: "build",
      agents: { build: { model: "openai/gpt-5.6" }, research: { model: "anthropic/claude-opus" } },
    } }))
    await writeFile(join(betaRoot, "home", ".omo", "agent", "settings.json"), JSON.stringify({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.6",
      modelThinkingLevels: { "anthropic/claude-opus": "high" },
    }))
    await writeFile(join(betaRoot, "home", ".omo", "omo.jsonc"), JSON.stringify({ "[senpi]": { categories: { local: { model: "omo-mock/mock-1" } } } }))

    // when
    const result = await runStandaloneParityCli({ action: "generate", realHome: home, betaRoot })

    // then
    expect(result.manifest?.skills).toEqual(["personal"])
    expect(result.manifest?.mcps.some((mcp) => mcp.name === "openviking")).toBe(true)
    expect(Object.keys(result.manifest?.files ?? {}).some((path) => path.includes("ovcli.conf"))).toBe(false)
    expect(await Bun.file(join(betaRoot, "standalone-parity", "staging", "manifest.json")).exists()).toBe(true)

    // when
    await runStandaloneParityCli({ action: "deploy", realHome: home, betaRoot })

    // then
    const deployedConfig = JSON.parse(await readFile(join(betaRoot, "home", ".omo", "omo.jsonc"), "utf8"))
    expect(deployedConfig).toEqual({
      "[senpi]": {
        agents: {
          build: { model: "openai-codex/gpt-5.6" },
          research: { model: "anthropic/claude-opus" },
        },
        categories: { local: { model: "omo-mock/mock-1" } },
      },
    })
    const deployedSettings = JSON.parse(await readFile(join(betaRoot, "home", ".omo", "agent", "settings.json"), "utf8"))
    expect(deployedSettings.packages).toEqual([join(betaRoot, "standalone-parity", "current", "package")])
    expect(await Bun.file(join(betaRoot, "standalone-parity", "current", "package", "package.json")).exists()).toBe(true)

    // when
    const rolledBack = await runStandaloneParityCli({ action: "rollback", realHome: home, betaRoot })

    // then
    expect(rolledBack.manifest).toBeUndefined()
    expect(await stat(join(betaRoot, "standalone-parity", "current"), { throwIfNoEntry: false })).toBeUndefined()
    expect(JSON.parse(await readFile(join(betaRoot, "home", ".omo", "omo.jsonc"), "utf8"))).toEqual({
      "[senpi]": { categories: { local: { model: "omo-mock/mock-1" } } },
    })
  })
})
