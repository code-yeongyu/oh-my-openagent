/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { CODEGRAPH_TELEMETRY_ENV, DO_NOT_TRACK_ENV } from "@oh-my-opencode/utils"
import { createCodegraphMcpConfig } from "./codegraph"
import type { RuntimeExecutable } from "./runtime-executable"

const PROXY = { command: ["node", "/opt/omo/codegraph-mcp/dist/cli.js"], exists: true } as const

describe("createCodegraphMcpConfig", () => {
  it("returns the freshness proxy command when the CodeGraph binary is present", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"
    const nodePath = "/opt/node22/bin/node"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: {},
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      nodeVersionForExecutable: (candidate) => (candidate === nodePath ? "22.14.0" : "26.3.0"),
      proxy: PROXY,
      resolveExecutable: createResolver({ codegraph: codegraphPath, node: nodePath }),
    })

    // then
    expect(config).toMatchObject({
      type: "local",
      command: PROXY.command,
      enabled: true,
    })
  })

  it("keeps the proxy enabled for on-demand provisioning when the codegraph binary is absent", () => {
    // given
    const resolveExecutable = createResolver({})

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      proxy: PROXY,
      resolveExecutable,
    })

    // then
    expect(config.command).toEqual(PROXY.command)
    expect(config.enabled).toBe(true)
  })

  it("keeps the registration disabled when OMO_CODEGRAPH_BIN points to a missing path", () => {
    // given
    const resolveExecutable = createResolver({ codegraph: "/usr/local/bin/codegraph" })

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: { OMO_CODEGRAPH_BIN: "/nonexistent" },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      proxy: PROXY,
      resolveExecutable,
    })

    // then
    expect(config.command).toEqual(PROXY.command)
    expect(config.enabled).toBe(false)
  })

  it("#given only a PATH CodeGraph binary and an unsupported host Node #when auto provisioning is enabled #then the proxy remains available", () => {
    // given
    const codegraphPath = "/usr/local/bin/codegraph"
    const nodePath = "/opt/node26/bin/node"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: {},
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      nodeVersionForExecutable: (candidate) => (candidate === nodePath ? "26.3.0" : "0.0.0"),
      proxy: PROXY,
      requireResolve: () => {
        throw new Error("bundled package absent")
      },
      resolveExecutable: createResolver({ codegraph: codegraphPath, node: nodePath }),
    })

    // then
    expect(config.command).toEqual(PROXY.command)
    expect(config.enabled).toBe(true)
  })

  it("#given OMO_CODEGRAPH_BIN points at an explicit command #when host Node is unsupported #then the MCP stays enabled", () => {
    // given
    const codegraphPath = "/opt/codegraph-node22/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: { OMO_CODEGRAPH_BIN: codegraphPath },
      fileExists: (filePath) => filePath === codegraphPath,
      homeDir: "/tmp/omo-codegraph-test-home",
      nodeVersionForExecutable: () => "26.3.0",
      proxy: PROXY,
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.command).toEqual(PROXY.command)
    expect(config.enabled).toBe(true)
  })

  it("#given a bundled CodeGraph shim and CODEGRAPH_NODE_BIN points at Node 22 #when creating the MCP config #then it enables the compatible command", () => {
    // given
    const packageJson = join("/bundle", "node_modules", "@colbymchenry", "codegraph", "package.json")
    const shim = join("/bundle", "node_modules", "@colbymchenry", "codegraph", "bin", "codegraph.js")
    const nodeBin = "/opt/node22/bin/node"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: { CODEGRAPH_NODE_BIN: nodeBin },
      fileExists: (filePath) => filePath === shim || filePath === nodeBin,
      homeDir: "/tmp/omo-codegraph-test-home",
      nodeVersionForExecutable: (candidate) => (candidate === nodeBin ? "22.22.3" : "26.3.0"),
      proxy: PROXY,
      requireResolve: () => packageJson,
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config).toMatchObject({
      command: PROXY.command,
      enabled: true,
      type: "local",
    })
  })
  it("forces telemetry off in the MCP environment", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      proxy: PROXY,
      resolveExecutable: createResolver({ codegraph: codegraphPath }),
    })

    // then
    expect(config.environment?.[CODEGRAPH_TELEMETRY_ENV]).toBe("0")
    expect(config.environment?.[DO_NOT_TRACK_ENV]).toBe("1")
  })

  it("passes disabled auto-init policy to the freshness proxy", () => {
    const config = createCodegraphMcpConfig({
      config: { auto_init: false, enabled: true },
      homeDir: "/tmp/omo-codegraph-test-home",
      proxy: PROXY,
      resolveExecutable: createResolver({ codegraph: "/opt/omo/codegraph/bin/codegraph" }),
    })

    expect(config.environment?.OMO_CODEGRAPH_AUTO_INIT).toBe("0")
  })

  it("uses configured install_dir for provisioned lookup and MCP environment", () => {
    // given
    const installDir = "/custom/codegraph"
    const provisionedPath = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
    const nodePath = "/opt/node22/bin/node"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true, install_dir: installDir },
      env: {},
      fileExists: (filePath) => filePath === provisionedPath,
      homeDir: "/tmp/omo-codegraph-test-home",
      nodeVersionForExecutable: (candidate) => (candidate === nodePath ? "22.14.0" : "26.3.0"),
      proxy: PROXY,
      requireResolve: () => {
        throw new Error("bundled package absent")
      },
      resolveExecutable: createResolver({ node: nodePath }),
    })

    // then
    expect(config).toMatchObject({
      type: "local",
      command: PROXY.command,
      enabled: true,
    })
    expect(config.environment?.CODEGRAPH_INSTALL_DIR).toBe(installDir)
  })
})

function createResolver(commands: Readonly<Record<string, string>>) {
  return (commandName: string): RuntimeExecutable => {
    const command = commands[commandName]
    return command ? { command, available: true } : { command: commandName, available: false }
  }
}
