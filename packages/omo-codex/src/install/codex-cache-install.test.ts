/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCachedPlugin } from "./codex-cache"

describe("codex-cache install", () => {
  test(
    "#given source plugin has development-only directories #when caching plugin #then writes only the plugin payload under the versioned cache",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-layout-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "plugin")
      await mkdir(join(sourceRoot, ".git", "objects"), { recursive: true })
      await mkdir(join(sourceRoot, "node_modules", "left-pad"), { recursive: true })
      await mkdir(join(sourceRoot, "components", "rules", "node_modules", "debug"), { recursive: true })
      await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
      await writeFile(join(sourceRoot, ".git", "HEAD"), "ref: refs/heads/dev\n")
      await writeFile(join(sourceRoot, "node_modules", "left-pad", "package.json"), "{}")
      await writeFile(join(sourceRoot, "components", "rules", "node_modules", "debug", "package.json"), "{}")
      await writeFile(join(sourceRoot, "components", "rules", "payload.txt"), "payload\n")

      // when
      const installed = await installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async () => undefined,
      })

      // then
      expect(installed.path).toBe(join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0"))
      expect(await readFile(join(installed.path, "components", "rules", "payload.txt"), "utf8")).toBe("payload\n")
      await expect(stat(join(installed.path, ".git"))).rejects.toThrow()
      await expect(stat(join(installed.path, "node_modules"))).rejects.toThrow()
      await expect(stat(join(installed.path, "components", "rules", "node_modules"))).rejects.toThrow()
    },
    15000,
  )

  test(
    "#given outer npx env has allow-scripts case variants #when caching plugin #then npm install commands preserve only unrelated env",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-npm-env-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "plugin")
      const env: NodeJS.ProcessEnv = {
        npm_config_allow_scripts: "@code-yeongyu/comment-checker",
        NPM_CONFIG_ALLOW_SCRIPTS: "@code-yeongyu/codex-ulw-loop",
        NpM_CoNfIg_AlLoW_ScRiPtS: "@code-yeongyu/codex-rules",
        npm_config_registry: "https://registry.example.test",
        "npm_config_//registry.example.test/:_authToken": "test-token",
        npm_config_https_proxy: "http://proxy.example.test:8080",
        PATH: "/test/bin",
        HOME: "/test/home",
      }
      const preservedEnv: NodeJS.ProcessEnv = {
        npm_config_registry: "https://registry.example.test",
        "npm_config_//registry.example.test/:_authToken": "test-token",
        npm_config_https_proxy: "http://proxy.example.test:8080",
        PATH: "/test/bin",
        HOME: "/test/home",
      }
      const npmInstallEnvs: Array<NodeJS.ProcessEnv | undefined> = []
      await mkdir(sourceRoot, { recursive: true })
      await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))

      // when
      await installCachedPlugin({
        codexHome,
        env,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async (command, args, options) => {
          if (command !== "npm") return
          expect(args).toEqual(npmInstallEnvs.length === 0 ? ["install"] : ["ci", "--omit=dev"])
          npmInstallEnvs.push(options.env)
        },
      })

      // then
      expect(npmInstallEnvs).toEqual([preservedEnv, preservedEnv])
    },
    15000,
  )

  test(
    "#given plugin has out-of-tree file: dependency #when caching plugin #then npm install reconciles instead of npm ci (lazycodex#137)",
    async () => {
      // given — a file: dependency escaping the plugin root forces the local-dependency rewrite,
      // after which the shipped package-lock.json no longer matches the mutated manifest and
      // `npm ci` would refuse with EUSAGE ("Missing: <pkg> from lock file").
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-local-dep-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "source", "packages", "omo-codex", "plugin")
      const sharedRoot = join(root, "source", "packages", "shared-skills")
      await mkdir(sourceRoot, { recursive: true })
      await mkdir(sharedRoot, { recursive: true })
      await writeFile(join(sharedRoot, "package.json"), JSON.stringify({ name: "@scope/shared-skills", version: "0.1.0" }))
      await writeFile(
        join(sourceRoot, "package.json"),
        JSON.stringify({
          name: "@scope/omo",
          version: "0.1.0",
          dependencies: { "@scope/shared-skills": "file:../../shared-skills" },
        }),
      )
      const npmArgs: string[][] = []

      // when
      const installed = await installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async (command, args) => {
          if (command === "npm") npmArgs.push([...args])
        },
      })

      // then — source-build install stays `npm install`; the cache-copy step must NOT be `npm ci`
      // because the rewrite mutated package.json (lock reconciliation is delegated to npm).
      expect(npmArgs).toEqual([["install"], ["install", "--omit=dev", "--no-audit", "--no-fund"]])
      const cachedManifest = JSON.parse(await readFile(join(installed.path, "package.json"), "utf8")) as {
        dependencies: Record<string, string>
      }
      expect(cachedManifest.dependencies["@scope/shared-skills"]).toBe(`file:${join(root, "source", "packages", "shared-skills")}`)
    },
    15000,
  )

  test(
    "#given a component ships its own nested .mcp.json #when caching plugin #then only the plugin-root .mcp.json is cached",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-mcp-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "plugin")
      await mkdir(join(sourceRoot, "components", "lsp"), { recursive: true })
      await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
      await writeFile(join(sourceRoot, ".mcp.json"), JSON.stringify({ mcpServers: { grep_app: { url: "https://mcp.grep.app" } } }))
      // A standalone-plugin dev manifest whose relative daemon path dangles once flattened into the cache.
      await writeFile(
        join(sourceRoot, "components", "lsp", ".mcp.json"),
        JSON.stringify({ mcpServers: { lsp: { command: "node", args: ["../../../../lsp-daemon/dist/cli.js", "mcp"] } } }),
      )

      // when
      const installed = await installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async () => undefined,
      })

      // then
      expect(await readFile(join(installed.path, ".mcp.json"), "utf8")).toContain("grep_app")
      await expect(stat(join(installed.path, "components", "lsp", ".mcp.json"))).rejects.toThrow()
    },
    15000,
  )

  test("#given source plugin references missing hook command target #when caching plugin #then previous active cache is preserved", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-hook-target-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0")
    await mkdir(join(sourceRoot, ".codex-plugin"), { recursive: true })
    await mkdir(join(sourceRoot, "hooks"), { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(sourceRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", hooks: "hooks/hooks.json" }))
    await writeFile(
      join(sourceRoot, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: 'node "${PLUGIN_ROOT}/dist/missing.js" hook stop' }] }],
        },
      }),
    )
    await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))

    // when
    await expect(
      installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async () => undefined,
      }),
    ).rejects.toThrow("Plugin payload is missing 1 hook command target")

    // then
    expect(await readFile(join(cacheRoot, "package.json"), "utf8")).toBe(JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))
    expect(await readdir(join(codexHome, "plugins", "cache", "debug", "omo"))).toEqual(["0.1.0"])
  })

  test("#given npm creates workspace bin shims in the cache #when caching plugin #then plugin-owned shims are removed", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-npm-bin-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const componentRoot = join(sourceRoot, "components", "ulw-loop")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "@scope/omo",
        version: "0.1.0",
        workspaces: ["components/ulw-loop"],
      }),
    )
    await writeFile(
      join(componentRoot, "package.json"),
      JSON.stringify({
        name: "@code-yeongyu/codex-ulw-loop",
        version: "0.1.0",
        bin: { "omo-ulw-loop": "dist/cli.js" },
      }),
    )
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const installed = await installCachedPlugin({
      codexHome,
      marketplaceName: "debug",
      name: "omo",
      sourcePath: sourceRoot,
      version: "0.1.0",
      runCommand: async (_command, args, options) => {
        if (args.join(" ") !== "ci --omit=dev") return
        const npmBinDir = join(options.cwd, "node_modules", ".bin")
        await mkdir(npmBinDir, { recursive: true })
        await writeFile(join(npmBinDir, "omo-ulw-loop"), "#!/bin/sh\nnode ../@code-yeongyu/codex-ulw-loop/dist/cli.js \"$@\"\n")
        await writeFile(
          join(npmBinDir, "omo-ulw-loop.cmd"),
          '@echo off\r\nnode "%~dp0\\..\\@code-yeongyu\\codex-ulw-loop\\dist\\cli.js" %*\r\n',
        )
        await writeFile(join(npmBinDir, "other-tool.cmd"), "@echo off\r\necho preserved\r\n")
      },
    })

    // then
    await expect(stat(join(installed.path, "node_modules", ".bin", "omo-ulw-loop"))).rejects.toThrow()
    await expect(stat(join(installed.path, "node_modules", ".bin", "omo-ulw-loop.cmd"))).rejects.toThrow()
    expect(await readFile(join(installed.path, "node_modules", ".bin", "other-tool.cmd"), "utf8")).toBe("@echo off\r\necho preserved\r\n")
  })

  test(
    "#given packaged plugin has stale aggregate skills #when caching plugin #then syncs skills after production dependencies install",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-skills-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "plugin")
      const commands: string[] = []
      await mkdir(join(sourceRoot, "scripts"), { recursive: true })
      await mkdir(join(sourceRoot, "skills", "ulw-plan"), { recursive: true })
      await writeFile(join(sourceRoot, "skills", "ulw-plan", "SKILL.md"), "---\nname: ulw-plan\n---\n")
      await writeFile(
        join(sourceRoot, "package.json"),
        JSON.stringify({
          name: "@scope/omo",
          version: "0.1.0",
          scripts: { "sync:skills": "node scripts/sync-skills.mjs" },
        }),
      )

      // when
      const installed = await installCachedPlugin({
        buildSource: false,
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async (command, args, options) => {
          commands.push(`${command} ${args.join(" ")}`)
          if (command === "npm" && args.join(" ") === "run sync:skills") {
            await mkdir(join(options.cwd, "skills", "ulw-research"), { recursive: true })
            await writeFile(join(options.cwd, "skills", "ulw-research", "SKILL.md"), "---\nname: ulw-research\n---\n")
          }
        },
      })

      // then
      expect(commands).toEqual(["npm ci --omit=dev", "npm run sync:skills"])
      expect(await readFile(join(installed.path, "skills", "ulw-research", "SKILL.md"), "utf8")).toContain("name: ulw-research")
    },
    15000,
  )
})
