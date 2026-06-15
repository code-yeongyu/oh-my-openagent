/// <reference path="../../../../bun-test.d.ts" />
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
  const lspRuntimeRoot = join(repoRoot, "packages", "lsp-daemon")
  const commands: Array<readonly [string, string, string]> = []

  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "4.5.12" }))
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(pluginRoot, "dist"), { recursive: true })
  await mkdir(join(pluginRoot, "components", "ulw-loop", "hooks"), { recursive: true })
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
  await writeFile(join(pluginRoot, "components", "ulw-loop", "package.json"), JSON.stringify({ name: "@code-yeongyu/codex-ulw-loop", version: "0.1.0" }))
  await writeFile(
    join(pluginRoot, "components", "ulw-loop", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit',
                statusMessage: "LazyCodex(0.1.0): Checking Ulw-Loop Steering",
              },
            ],
          },
        ],
      },
    }),
  )
  await mkdir(join(pluginRoot, "hooks"), { recursive: true })
  await writeFile(
    join(pluginRoot, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
                statusMessage: "LazyCodex(0.1.0): Checking Comments",
              },
            ],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { lsp: { command: "node", args: ["../../lsp-daemon/dist/cli.js", "mcp"], cwd: "." } } }),
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
  const cachedManifest = JSON.parse(await readFile(join(pluginPath, ".codex-plugin", "plugin.json"), "utf8")) as { readonly version: string }
  const cachedPackage = JSON.parse(await readFile(join(pluginPath, "package.json"), "utf8")) as { readonly version: string }
  const cachedComponentPackage = JSON.parse(await readFile(join(pluginPath, "components", "ulw-loop", "package.json"), "utf8")) as { readonly version: string }
  const cachedHooks = JSON.parse(await readFile(join(pluginPath, "hooks", "hooks.json"), "utf8")) as {
    readonly hooks: { readonly PostToolUse: readonly [{ readonly hooks: readonly [{ readonly statusMessage: string }] }] }
  }
  const cachedComponentHooks = JSON.parse(await readFile(join(pluginPath, "components", "ulw-loop", "hooks", "hooks.json"), "utf8")) as {
    readonly hooks: { readonly UserPromptSubmit: readonly [{ readonly hooks: readonly [{ readonly statusMessage: string }] }] }
  }
  const cachedMcp = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as {
    readonly mcpServers: { readonly lsp: { readonly args: readonly string[]; readonly cwd?: string } }
  }
  const cachedLspCli = join(pluginPath, "components", "lsp-daemon", "dist", "cli.js")

  expect(result.installed.map((plugin) => `${plugin.name}@${plugin.version}`)).toEqual(["omo@4.5.12"])
  expect(pluginPath).toBe(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "4.5.12"))
  expect(cachedManifest.version).toBe("4.5.12")
  expect(cachedPackage.version).toBe("4.5.12")
  expect(cachedComponentPackage.version).toBe("4.5.12")
  expect(cachedHooks.hooks.PostToolUse[0].hooks[0].statusMessage).toBe("LazyCodex(4.5.12): Checking Comments")
  expect(cachedComponentHooks.hooks.UserPromptSubmit[0].hooks[0].statusMessage).toBe("LazyCodex(4.5.12): Checking Ulw-Loop Steering")
  expect(commands).toHaveLength(1)
  const installCommand = commands[0]
  if (installCommand === undefined) throw new Error("missing cached plugin npm install command")
  expect(installCommand[0]).toBe("npm")
  expect(installCommand[1]).toBe("ci --omit=dev")
  expect(installCommand[2].startsWith(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", ".tmp-4.5.12-"))).toBe(true)
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
  const lspRuntimeRoot = join(repoRoot, "packages", "lsp-daemon")

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
    JSON.stringify({ mcpServers: { lsp: { command: "node", args: ["../../lsp-daemon/dist/cli.js", "mcp"], cwd: "." } } }),
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
