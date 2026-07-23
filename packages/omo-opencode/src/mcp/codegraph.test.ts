/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CODEGRAPH_NO_DAEMON_ENV, CODEGRAPH_TELEMETRY_ENV, DO_NOT_TRACK_ENV } from "@oh-my-opencode/utils"
import { createCodegraphMcpConfig } from "./codegraph"
import type { RuntimeExecutable } from "./runtime-executable"

describe("createCodegraphMcpConfig", () => {
  it("returns a local MCP command that launches codegraph serve --mcp when the binary is present", () => {
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
      resolveExecutable: createResolver({ codegraph: codegraphPath, node: nodePath }),
    })

    // then
    expect(config).toMatchObject({
      type: "local",
      command: [codegraphPath, "serve", "--mcp"],
      enabled: true,
    })
  })

  it("keeps the registration disabled when the codegraph binary is absent", () => {
    // given
    const resolveExecutable = createResolver({})

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      resolveExecutable,
    })

    // then
    expect(config.command).toEqual(["codegraph", "serve", "--mcp"])
    expect(config.enabled).toBe(false)
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
      resolveExecutable,
    })

    // then
    expect(config.command).toEqual(["/nonexistent", "serve", "--mcp"])
    expect(config.enabled).toBe(false)
  })

  it("#given only a PATH CodeGraph binary and an unsupported host Node #when creating the MCP config #then it stays disabled", () => {
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
      requireResolve: () => {
        throw new Error("bundled package absent")
      },
      resolveExecutable: createResolver({ codegraph: codegraphPath, node: nodePath }),
    })

    // then
    expect(config.command).toEqual([codegraphPath, "serve", "--mcp"])
    expect(config.enabled).toBe(false)
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
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.command).toEqual([codegraphPath, "serve", "--mcp"])
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
      requireResolve: () => packageJson,
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config).toMatchObject({
      command: [nodeBin, shim, "serve", "--mcp"],
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
      resolveExecutable: createResolver({ codegraph: codegraphPath }),
    })

    // then
    expect(config.environment?.[CODEGRAPH_TELEMETRY_ENV]).toBe("0")
    expect(config.environment?.[DO_NOT_TRACK_ENV]).toBe("1")
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
      requireResolve: () => {
        throw new Error("bundled package absent")
      },
      resolveExecutable: createResolver({ node: nodePath }),
    })

    // then
    expect(config).toMatchObject({
      type: "local",
      command: [provisionedPath, "serve", "--mcp"],
      enabled: true,
    })
    expect(config.environment?.CODEGRAPH_INSTALL_DIR).toBe(installDir)
  })

  it("pins CODEGRAPH_NO_DAEMON=1 in the MCP environment when daemon is not opted in", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true },
      env: { OMO_CODEGRAPH_BIN: codegraphPath },
      fileExists: (filePath) => filePath === codegraphPath,
      homeDir: "/tmp/omo-codegraph-test-home",
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.environment?.[CODEGRAPH_NO_DAEMON_ENV]).toBe("1")
  })

  it("omits CODEGRAPH_NO_DAEMON from the MCP environment when daemon=true", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { daemon: true, enabled: true },
      env: { OMO_CODEGRAPH_BIN: codegraphPath },
      fileExists: (filePath) => filePath === codegraphPath,
      homeDir: "/tmp/omo-codegraph-test-home",
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.environment?.[CODEGRAPH_NO_DAEMON_ENV]).toBeUndefined()
  })

  it("keeps the registration disabled when the project is under a configured excluded root", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/excluded/project",
      config: { enabled: true, excluded_roots: ["/excluded"] },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      resolveExecutable: createResolver({ codegraph: codegraphPath }),
    })

    // then
    expect(config.command).toEqual([codegraphPath, "serve", "--mcp"])
    expect(config.enabled).toBe(false)
  })

  it("keeps the registration disabled when the project lives under the OS tmpdir by default", () => {
    // given
    const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

    // when
    const config = createCodegraphMcpConfig({
      cwd: join(tmpdir(), "omo-codegraph-mcp-excluded-probe"),
      config: { enabled: true },
      fileExists: () => false,
      homeDir: "/tmp/omo-codegraph-test-home",
      resolveExecutable: createResolver({ codegraph: codegraphPath }),
    })

    // then
    expect(config.enabled).toBe(false)
  })
})

function createResolver(commands: Readonly<Record<string, string>>) {
  return (commandName: string): RuntimeExecutable => {
    const command = commands[commandName]
    return command ? { command, available: true } : { command: commandName, available: false }
  }
}
