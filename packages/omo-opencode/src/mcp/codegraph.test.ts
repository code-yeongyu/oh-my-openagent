import { describe, expect, it } from "bun:test"
import { CODEGRAPH_TELEMETRY_ENV, DO_NOT_TRACK_ENV } from "@oh-my-opencode/utils"
import { createCodegraphMcpConfig } from "./codegraph"
import type { RuntimeExecutable } from "./runtime-executable"

describe("createCodegraphMcpConfig", () => {
  it("returns a local MCP command that launches codegraph serve --mcp when the binary is present", () => {
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
    const provisionedPath = `${installDir}/bin/${process.platform === "win32" ? "codegraph.exe" : "codegraph"}`

    // when
    const config = createCodegraphMcpConfig({
      cwd: "/workspace/project",
      config: { enabled: true, install_dir: installDir },
      fileExists: (filePath) => filePath === provisionedPath,
      homeDir: "/tmp/omo-codegraph-test-home",
      requireResolve: () => {
        throw new Error("bundled package absent")
      },
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config).toMatchObject({
      type: "local",
      command: [provisionedPath, "serve", "--mcp"],
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
