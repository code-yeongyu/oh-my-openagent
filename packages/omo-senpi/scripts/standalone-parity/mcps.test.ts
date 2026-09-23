/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateStandaloneParity } from "./generator"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone parity MCP declarations", () => {
  test("#given compatible HTTP and stdio MCP declarations #when generating #then emits typed Senpi-compatible declarations", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-mcps-"))
    roots.push(root)
    const configPath = join(root, "mcp.json")
    const outputRoot = join(root, "output")
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        docs: { type: "http", url: "https://example.test/mcp", enabled: true },
        local: { type: "stdio", command: "bun", args: ["run", "server.ts"], env: { MODE: "test" } },
      },
    }))

    // when
    const generated = await generateStandaloneParity({ outputRoot, skillRoots: [], commandRoots: [], instructionPaths: [], mcpConfigPaths: [configPath] })

    // then
    expect(generated.manifest.mcps).toEqual([
      { name: "docs", declaration: { type: "http", url: "https://example.test/mcp", enabled: true } },
      { name: "local", declaration: { type: "stdio", command: "bun", args: ["run", "server.ts"], env: { MODE: "test" } } },
    ])
  })

  test("#given literal secrets, native collisions, missing executables, or unsupported transports #when generating #then rejects each unsafe declaration", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-mcps-"))
    roots.push(root)
    const outputRoot = join(root, "output")
    const secretPath = join(root, "secret.json")
    const collisionPath = join(root, "collision.json")
    const missingPath = join(root, "missing.json")
    const transportPath = join(root, "transport.json")
    await writeFile(secretPath, JSON.stringify({ mcpServers: { private: { type: "http", url: "https://example.test/mcp", headers: { Authorization: "Bearer literal" } } } }))
    await writeFile(collisionPath, JSON.stringify({ mcpServers: { context7: { type: "http", url: "https://example.test/mcp" } } }))
    await writeFile(missingPath, JSON.stringify({ mcpServers: { missing: { type: "stdio", command: "definitely-not-an-executable" } } }))
    await writeFile(transportPath, JSON.stringify({ mcpServers: { sse: { type: "sse", url: "https://example.test/mcp" } } }))

    // when
    const inputFor = (name: string, path: string): Parameters<typeof generateStandaloneParity>[0] => ({
      outputRoot: join(root, name),
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      mcpConfigPaths: [path],
    })
    // then
    await expect(generateStandaloneParity(inputFor("secret-output", secretPath))).rejects.toThrow("literal secret rejected")
    await expect(generateStandaloneParity(inputFor("collision-output", collisionPath))).rejects.toThrow("native MCP collision")
    await expect(generateStandaloneParity(inputFor("missing-output", missingPath))).rejects.toThrow("MCP executable not found")
    await expect(generateStandaloneParity(inputFor("transport-output", transportPath))).rejects.toThrow("unsupported MCP transport")
  })

  test("#given the pinned OpenViking package and credential paths #when generating #then copies code only and emits an isolated proxy declaration", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-openviking-proxy-"))
    roots.push(root)
    const pluginRoot = join(root, "plugin")
    const outputRoot = join(root, "output")
    const credentialPath = join(root, "ovcli.conf")
    const configPath = join(root, "openviking-config.json")
    await mkdir(join(pluginRoot, "servers"), { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@openviking/opencode-plugin", version: "0.2.4" }))
    await writeFile(join(pluginRoot, "servers", "mcp-proxy.mjs"), "process.stdin.resume()\n")
    await writeFile(credentialPath, JSON.stringify({ api_key: "must-not-be-copied" }))
    await writeFile(configPath, JSON.stringify({ timeoutMs: 1234 }))

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      openVikingPluginRoot: pluginRoot,
      openVikingCredentialPath: credentialPath,
      openVikingConfigPath: configPath,
    })

    // then
    expect(generated.manifest.mcps).toContainEqual({
      name: "openviking",
      declaration: {
        type: "stdio",
        command: "node",
        args: ["${OMO_STANDALONE_PARITY_ROOT}/openviking-plugin/servers/mcp-proxy.mjs"],
        env: {
          OPENVIKING_CLI_CONFIG_FILE: credentialPath,
          OPENVIKING_PLUGIN_CONFIG: configPath,
        },
      },
    })
    expect(await readFile(join(outputRoot, "openviking-plugin", "servers", "mcp-proxy.mjs"), "utf8")).toBe("process.stdin.resume()\n")
    expect(Object.keys(generated.manifest.files).some((path) => path.includes("ovcli.conf"))).toBe(false)
  })

  test("#given an unpinned OpenViking package #when generating #then rejects it before copying", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-openviking-version-"))
    roots.push(root)
    const pluginRoot = join(root, "plugin")
    await mkdir(join(pluginRoot, "servers"), { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@openviking/opencode-plugin", version: "9.9.9" }))
    await writeFile(join(pluginRoot, "servers", "mcp-proxy.mjs"), "process.stdin.resume()\n")

    // when
    const result = generateStandaloneParity({
      outputRoot: join(root, "output"),
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      openVikingPluginRoot: pluginRoot,
    })

    // then
    await expect(result).rejects.toThrow("OpenViking package version must be 0.2.4")
  })
})
