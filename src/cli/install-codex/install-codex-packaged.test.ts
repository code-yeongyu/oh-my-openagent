/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readlink, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

test("#given packaged lazycodex tarball layout #when installing Codex plugin #then uses bundled artifacts without source builds", async () => {
  // given
  const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-packaged-root-"))
  const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-packaged-home-"))
  const binDir = await mkdtemp(join(tmpdir(), "omo-codex-packaged-bin-"))
  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const pluginRoot = join(codexPackageRoot, "plugin")
  const lspRuntimeRoot = join(repoRoot, "packages", "lsp-tools-mcp")
  const commands: Array<readonly [string, string, string]> = []

  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "4.5.12" }))
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(pluginRoot, "dist"), { recursive: true })
  await mkdir(join(lspRuntimeRoot, "dist"), { recursive: true })
  await writeFile(
    join(codexPackageRoot, "marketplace.json"),
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: "./plugin" }] }),
  )
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "omo", version: "0.1.0", hooks: "hooks/hooks.json" }),
  )
  await writeFile(
    join(pluginRoot, "package.json"),
    JSON.stringify({
      name: "@sisyphuslabs/omo-codex-plugin",
      version: "0.1.0",
      bin: { omo: "dist/cli.js" },
      scripts: { build: "exit 42" },
    }),
  )
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { lsp: { command: "node", args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." } } }),
  )
  await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
  await writeFile(join(lspRuntimeRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

  // when
  const result = await runCodexInstaller({
    codexHome,
    binDir,
    repoRoot,
    platform: "linux",
    runCommand: async (command, args, options) => {
      commands.push([command, args.join(" "), options.cwd])
    },
  })

  // then
  const pluginPath = result.installed[0]?.path ?? ""
  const cachedMcp = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as {
    readonly mcpServers: { readonly lsp: { readonly args: readonly string[]; readonly cwd?: string } }
  }
  const cachedLspCli = join(pluginPath, "components", "lsp-tools-mcp", "dist", "cli.js")

  expect(commands).toEqual([["npm", "install --omit=dev", pluginPath]])
  expect(cachedMcp.mcpServers.lsp.cwd).toBeUndefined()
  expect(cachedMcp.mcpServers.lsp.args).toEqual([cachedLspCli, "mcp"])
  expect(cachedMcp.mcpServers.lsp.args[0]).not.toBe(join(lspRuntimeRoot, "dist", "cli.js"))
  expect((await stat(cachedLspCli)).isFile()).toBe(true)
  expect(await readlink(join(binDir, "omo"))).toBe(join(pluginPath, "dist", "cli.js"))
})

test("#given packaged lazycodex tarball layout #when simulating Windows install #then links bin shims for that platform", async () => {
  // given
  const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-packaged-root-win-"))
  const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-packaged-home-win-"))
  const binDir = await mkdtemp(join(tmpdir(), "omo-codex-packaged-bin-win-"))
  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const pluginRoot = join(codexPackageRoot, "plugin")
  const lspRuntimeRoot = join(repoRoot, "packages", "lsp-tools-mcp")

  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "4.5.12" }))
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(pluginRoot, "dist"), { recursive: true })
  await mkdir(join(lspRuntimeRoot, "dist"), { recursive: true })
  await writeFile(
    join(codexPackageRoot, "marketplace.json"),
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: "./plugin" }] }),
  )
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "omo", version: "0.1.0", hooks: "hooks/hooks.json" }),
  )
  await writeFile(
    join(pluginRoot, "package.json"),
    JSON.stringify({
      name: "@sisyphuslabs/omo-codex-plugin",
      version: "0.1.0",
      bin: { omo: "dist/cli.js" },
    }),
  )
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { lsp: { command: "node", args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." } } }),
  )
  await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
  await writeFile(join(lspRuntimeRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

  // when
  const result = await runCodexInstaller({
    codexHome,
    binDir,
    repoRoot,
    platform: "win32",
    gitBashResolver: () => ({ found: true, path: "C:\\Program Files\\Git\\bin\\bash.exe", source: "program-files" }),
    runCommand: async () => undefined,
  })

  // then
  const pluginPath = result.installed[0]?.path ?? ""
  const commandShim = await readFile(join(binDir, "omo.cmd"), "utf8")
  expect(commandShim).toContain(join(pluginPath, "dist", "cli.js"))
})
