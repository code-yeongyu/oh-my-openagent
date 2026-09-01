/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readlink, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

test("#given a canonical reasoning level #when the Codex installer runs #then config.toml carries the mapped model_reasoning_effort", async () => {
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
  await mkdir(join(pluginRoot, "components", "comment-checker", "dist"), { recursive: true })
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
  await writeFile(join(pluginRoot, "components", "comment-checker", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await writeFile(join(lspRuntimeRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

  // when
  const result = await runCodexInstaller({
    codexHome,
    binDir,
    repoRoot,
    platform: "linux",
    reasoning: "off",
    astGrepInstaller: skipAstGrepInstall,
    runCommand: async (command, args, options) => {
      commands.push([command, args.join(" "), options.cwd])
    },
  })

  // then
  const configToml = await readFile(join(codexHome, "config.toml"), "utf8")
  expect(configToml).toContain('model_reasoning_effort = "none"')
  expect(configToml).not.toContain('model_reasoning_effort = "high"')
})
