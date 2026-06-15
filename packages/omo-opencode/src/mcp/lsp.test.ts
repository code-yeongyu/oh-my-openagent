import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createLspMcpConfig } from "./lsp"
import type { RuntimeExecutable } from "./runtime-executable"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("createLspMcpConfig", () => {
  it("resolves bundled dist cli from module root when cwd is unrelated", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-package-root-")
    const unrelatedCwd = createTemporaryDirectory("omo-lsp-unrelated-cwd-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const cliPath = join(packageRoot, "packages", "lsp-daemon", "dist", "cli.js")
    const nodePath = join(packageRoot, "bin", "node")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "dist"), { recursive: true })
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: unrelatedCwd,
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ node: nodePath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([nodePath, cliPath, "mcp"])
  })

  it("uses the bun daemon source cli when the engine dist is already built", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-source-root-")
    const moduleFilePath = join(packageRoot, "src", "mcp", "lsp.ts")
    const sourceCliPath = join(packageRoot, "packages", "lsp-daemon", "src", "cli.ts")
    const toolsDistPath = join(packageRoot, "packages", "lsp-tools-mcp", "dist", "cli.js")
    const bunPath = join(packageRoot, "bin", "bun")
    mkdirSync(join(packageRoot, "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "src"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    writeFileSync(sourceCliPath, "console.log('mcp')\n", "utf-8")
    writeFileSync(toolsDistPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-source-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([bunPath, sourceCliPath, "mcp"])
  })

  it("prefers an ancestor dist cli before an earlier source cli candidate", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-order-root-")
    const moduleFilePath = join(packageRoot, "nested", "src", "mcp", "lsp.ts")
    const nearerSourceCliPath = join(packageRoot, "nested", "src", "mcp", "packages", "lsp-daemon", "src", "cli.ts")
    const nearerToolsDistPath = join(packageRoot, "nested", "src", "mcp", "packages", "lsp-tools-mcp", "dist", "cli.js")
    const ancestorDistCliPath = join(packageRoot, "packages", "lsp-daemon", "dist", "cli.js")
    const nodePath = join(packageRoot, "bin", "node")
    const bunPath = join(packageRoot, "bin", "bun")
    mkdirSync(join(packageRoot, "nested", "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "nested", "src", "mcp", "packages", "lsp-daemon", "src"), { recursive: true })
    mkdirSync(join(packageRoot, "nested", "src", "mcp", "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "dist"), { recursive: true })
    writeFileSync(nearerSourceCliPath, "console.log('near-source')\n", "utf-8")
    writeFileSync(nearerToolsDistPath, "#!/usr/bin/env node\n", "utf-8")
    writeFileSync(ancestorDistCliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-order-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath, node: nodePath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([nodePath, ancestorDistCliPath, "mcp"])
  })

  it("uses the nearest source cli when no dist cli exists in the ancestor walk", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-source-order-root-")
    const moduleFilePath = join(packageRoot, "nested", "src", "mcp", "lsp.ts")
    const nearerSourceCliPath = join(packageRoot, "nested", "src", "mcp", "packages", "lsp-daemon", "src", "cli.ts")
    const nearerToolsDistPath = join(packageRoot, "nested", "src", "mcp", "packages", "lsp-tools-mcp", "dist", "cli.js")
    const ancestorSourceCliPath = join(packageRoot, "packages", "lsp-daemon", "src", "cli.ts")
    const ancestorToolsDistPath = join(packageRoot, "packages", "lsp-tools-mcp", "dist", "cli.js")
    const bunPath = join(packageRoot, "bin", "bun")
    mkdirSync(join(packageRoot, "nested", "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "nested", "src", "mcp", "packages", "lsp-daemon", "src"), { recursive: true })
    mkdirSync(join(packageRoot, "nested", "src", "mcp", "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "src"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    writeFileSync(nearerSourceCliPath, "console.log('near-source')\n", "utf-8")
    writeFileSync(nearerToolsDistPath, "#!/usr/bin/env node\n", "utf-8")
    writeFileSync(ancestorSourceCliPath, "console.log('ancestor-source')\n", "utf-8")
    writeFileSync(ancestorToolsDistPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-source-order-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([bunPath, nearerSourceCliPath, "mcp"])
  })

  it("does not run the bun daemon source cli when the engine dist is missing; bootstraps instead", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-source-no-engine-root-")
    const moduleFilePath = join(packageRoot, "src", "mcp", "lsp.ts")
    const sourceCliPath = join(packageRoot, "packages", "lsp-daemon", "src", "cli.ts")
    const bunPath = join(packageRoot, "bin", "bun")
    const nodePath = join(packageRoot, "bin", "node")
    const npmPath = join(packageRoot, "bin", "npm")
    mkdirSync(join(packageRoot, "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "src"), { recursive: true })
    writeFileSync(sourceCliPath, "console.log('mcp')\n", "utf-8")
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode" }), "utf-8")
    writeFileSync(
      join(packageRoot, "packages", "lsp-daemon", "package.json"),
      JSON.stringify({ name: "@code-yeongyu/lsp-daemon" }),
      "utf-8",
    )

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-source-no-engine-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath, node: nodePath, npm: npmPath }),
    })

    // then
    expect(config.command).not.toContain(sourceCliPath)
    expect(config.command[1]).toBe("-e")
    expect(config.command[3]).toBe(packageRoot)
    expect(config.enabled).toBe(true)
  })

  it("does not resolve the MCP command from the opened workspace", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-safe-package-root-")
    const workspaceRoot = createTemporaryDirectory("omo-lsp-malicious-workspace-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const workspaceCliPath = join(workspaceRoot, "packages", "lsp-daemon", "dist", "cli.js")
    const gitPath = join(packageRoot, "bin", "git")
    const bunPath = join(packageRoot, "bin", "bun")
    const nodePath = join(packageRoot, "bin", "node")
    const npmPath = join(packageRoot, "bin", "npm")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon"), { recursive: true })
    mkdirSync(join(workspaceRoot, "packages", "lsp-daemon", "dist"), { recursive: true })
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode" }), "utf-8")
    writeFileSync(
      join(packageRoot, "packages", "lsp-daemon", "package.json"),
      JSON.stringify({ name: "@code-yeongyu/lsp-daemon" }),
      "utf-8",
    )
    writeFileSync(workspaceCliPath, "console.log('malicious')\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: workspaceRoot,
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath, git: gitPath, node: nodePath, npm: npmPath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command[1]).not.toBe(workspaceCliPath)
    expect(config.command[1]).toBe("-e")
    expect(config.command[3]).toBe(packageRoot)
  })

  it("disables the MCP config when the vendored LSP package metadata is missing", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-no-package-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const bunPath = join(packageRoot, "bin", "bun")
    const nodePath = join(packageRoot, "bin", "node")
    const npmPath = join(packageRoot, "bin", "npm")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode" }), "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-no-package-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath, node: nodePath, npm: npmPath }),
    })

    // then
    expect(config.enabled).toBe(false)
  })

  it("returns a vendored package bootstrap command when no LSP cli entrypoint exists", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-missing-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const bunPath = join(packageRoot, "bin", "bun")
    const nodePath = join(packageRoot, "bin", "node")
    const npmPath = join(packageRoot, "bin", "npm")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon"), { recursive: true })
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode" }), "utf-8")
    writeFileSync(
      join(packageRoot, "packages", "lsp-daemon", "package.json"),
      JSON.stringify({ name: "@code-yeongyu/lsp-daemon" }),
      "utf-8",
    )

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-missing-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath, node: nodePath, npm: npmPath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command[0]).toBe(nodePath)
    expect(config.command[1]).toBe("-e")
    const script = config.command[2] as string
    expect(script).not.toContain("submodule")
    expect(script).toContain("npm")
    expect(script).toContain("build")
    expect(script).toContain("packages/lsp-tools-mcp")
    expect(script).toContain("packages/lsp-daemon")
    expect(script.indexOf("packages/lsp-tools-mcp")).toBeLessThan(script.indexOf("packages/lsp-daemon"))
    expect(config.command[3]).toBe(packageRoot)
    expect(config.command[4]).toBe(npmPath)
    expect(config.command[5]).toBe(bunPath)
  })

  it("disables the MCP config when no runtime can launch any LSP candidate", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-no-runtime-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const cliPath = join(packageRoot, "packages", "lsp-daemon", "dist", "cli.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-daemon", "dist"), { recursive: true })
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-no-runtime-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.enabled).toBe(false)
    expect(config.environment?.LSP_TOOLS_MCP_PROJECT_CONFIG).toContain(".opencode/lsp.json")
    expect(config.environment?.LSP_TOOLS_MCP_PROJECT_CONFIG).toContain(".omo/lsp.json")
    expect(config.environment?.LSP_TOOLS_MCP_PROJECT_CONFIG).toContain(".omo/lsp-client.json")
  })
})

function createResolver(commands: Readonly<Record<string, string>>) {
  return (commandName: string): RuntimeExecutable => {
    const command = commands[commandName]
    return command ? { command, available: true } : { command: commandName, available: false }
  }
}
