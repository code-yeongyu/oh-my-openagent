import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createAstGrepMcpConfig } from "./ast-grep"
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

describe("createAstGrepMcpConfig", () => {
  it("resolves bundled dist cli from module root when cwd is unrelated", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-package-root-")
    const unrelatedCwd = createTemporaryDirectory("omo-ast-grep-unrelated-cwd-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const cliPath = join(packageRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
    const nodePath = join(packageRoot, "bin", "node")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "ast-grep-mcp", "dist"), { recursive: true })
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createAstGrepMcpConfig({
      cwd: unrelatedCwd,
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ node: nodePath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([nodePath, cliPath, "mcp"])
    expect(config.environment?.OMO_AST_GREP_WORKSPACE).toBe(unrelatedCwd)
  })

  it("falls back to bun source cli for source checkouts before build", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-source-root-")
    const moduleFilePath = join(packageRoot, "src", "mcp", "ast-grep.ts")
    const sourceCliPath = join(packageRoot, "packages", "ast-grep-mcp", "src", "cli.ts")
    const bunPath = join(packageRoot, "bin", "bun")
    mkdirSync(join(packageRoot, "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "ast-grep-mcp", "src"), { recursive: true })
    writeFileSync(sourceCliPath, "console.log('mcp')\n", "utf-8")

    // when
    const config = createAstGrepMcpConfig({
      cwd: createTemporaryDirectory("omo-ast-grep-source-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ bun: bunPath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual([bunPath, sourceCliPath, "mcp"])
  })

  it("still returns a built-in MCP config when the cli has not been built yet", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-missing-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const nodePath = join(packageRoot, "bin", "node")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })

    // when
    const config = createAstGrepMcpConfig({
      cwd: createTemporaryDirectory("omo-ast-grep-missing-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ node: nodePath }),
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command[0]).toBe(nodePath)
    expect(config.command[1]).toContain(join("packages", "ast-grep-mcp", "dist", "cli.js"))
    expect(config.command[2]).toBe("mcp")
  })

  it("disables the MCP config when no runtime can launch ast-grep", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-no-runtime-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const cliPath = join(packageRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "ast-grep-mcp", "dist"), { recursive: true })
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createAstGrepMcpConfig({
      cwd: createTemporaryDirectory("omo-ast-grep-no-runtime-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({}),
    })

    // then
    expect(config.enabled).toBe(false)
  })

  it("does not resolve the MCP command from the opened workspace", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-safe-package-root-")
    const workspaceRoot = createTemporaryDirectory("omo-ast-grep-malicious-workspace-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    const workspaceCliPath = join(workspaceRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(workspaceRoot, "packages", "ast-grep-mcp", "dist"), { recursive: true })
    writeFileSync(workspaceCliPath, "console.log('malicious')\n", "utf-8")

    // when
    const config = createAstGrepMcpConfig({
      cwd: workspaceRoot,
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ node: join(packageRoot, "bin", "node") }),
    })

    // then
    expect(config.command[1]).not.toBe(workspaceCliPath)
    expect(config.command[1]).toContain(packageRoot)
  })

  it("maps disabled ast-grep tool names to MCP subtools", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-ast-grep-disabled-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })

    // when
    const config = createAstGrepMcpConfig({
      cwd: createTemporaryDirectory("omo-ast-grep-disabled-cwd-"),
      disabledTools: ["ast_grep_replace", "glob"],
      moduleUrl: pathToFileURL(moduleFilePath).href,
      resolveExecutable: createResolver({ node: join(packageRoot, "bin", "node") }),
    })

    // then
    expect(config.environment?.OMO_AST_GREP_DISABLED_TOOLS).toBe("replace")
  })
})

function createResolver(commands: Readonly<Record<string, string>>) {
  return (commandName: string): RuntimeExecutable => {
    const command = commands[commandName]
    return command ? { command, available: true } : { command: commandName, available: false }
  }
}
