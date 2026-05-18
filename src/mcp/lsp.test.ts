import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createLspMcpConfig } from "./lsp"

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
    const cliPath = join(packageRoot, "packages", "lsp-tools-mcp", "dist", "cli.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: unrelatedCwd,
      moduleUrl: pathToFileURL(moduleFilePath).href,
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual(["node", cliPath, "mcp"])
  })

  it("falls back to bun source cli for source checkouts before build", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-source-root-")
    const moduleFilePath = join(packageRoot, "src", "mcp", "lsp.ts")
    const sourceCliPath = join(packageRoot, "packages", "lsp-tools-mcp", "src", "cli.ts")
    mkdirSync(join(packageRoot, "src", "mcp"), { recursive: true })
    mkdirSync(join(packageRoot, "packages", "lsp-tools-mcp", "src"), { recursive: true })
    writeFileSync(sourceCliPath, "console.log('mcp')\n", "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-source-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command).toEqual(["bun", sourceCliPath, "mcp"])
  })

  it("returns a bootstrap command when no LSP cli entrypoint exists", () => {
    // given
    const packageRoot = createTemporaryDirectory("omo-lsp-missing-root-")
    const moduleFilePath = join(packageRoot, "dist", "index.js")
    mkdirSync(join(packageRoot, "dist"), { recursive: true })
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode" }), "utf-8")

    // when
    const config = createLspMcpConfig({
      cwd: createTemporaryDirectory("omo-lsp-missing-cwd-"),
      moduleUrl: pathToFileURL(moduleFilePath).href,
    })

    // then
    expect(config.enabled).toBe(true)
    expect(config.command[0]).toBe("node")
    expect(config.command[1]).toBe("-e")
    expect(config.command[2]).toContain("submodule")
    expect(config.command[2]).toContain("npm")
    expect(config.command[3]).toBe(packageRoot)
  })
})
