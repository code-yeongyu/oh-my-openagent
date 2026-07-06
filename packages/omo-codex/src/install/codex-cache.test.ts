/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

// allow: SIZE_OK - cache install tests share one managed Codex cache fixture; this release adds narrow context cleanup coverage and future additions should split by cache operation.

import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, sep } from "node:path"
import { installCachedPlugin, linkCachedPluginBins, rewriteCachedMcpManifest } from "./codex-cache"

const BROKEN_WINDOWS_DOUBLE_QUOTE_TRIM = 'if "!OMO_NODE_BINARY:~0,1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"'

describe("codex-cache", () => {
  test("rewrites cached mcp manifest relative args and cwd", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { lsp: { cwd: ".", args: ["./components/lsp/dist/cli.js", "mcp"] } } }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const rewritten = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: { lsp: { cwd?: string; args: string[] } }
    }
    expect(rewritten.mcpServers.lsp.cwd).toBeUndefined()
    expect(rewritten.mcpServers.lsp.args[0]).toBe(join(root, "./components/lsp/dist/cli.js"))
  })

  test("#given cached CodeGraph manifest uses bare package-relative entrypoint #when rewriting before bootstrap #then entrypoint becomes absolute under plugin root", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-codegraph-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          codegraph: {
            command: "node",
            args: ["components/codegraph/dist/serve.js"],
            cwd: ".",
            required: false,
          },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const rewritten = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: { codegraph: { cwd?: string; args: string[] } }
    }
    expect(rewritten.mcpServers.codegraph.cwd).toBeUndefined()
    expect(rewritten.mcpServers.codegraph.args).toEqual([join(root, "components", "codegraph", "dist", "serve.js")])
  })

  test("rewrites bundled mcp manifest args that point outside the plugin cache into bundled cache paths", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const sourceRoot = join(root, "packages", "omo-codex", "plugin")
    const cacheRoot = join(root, "cache", "omo")
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(
      join(cacheRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          custom: { args: ["/usr/local/bin/custom-mcp", "--stdio"] },
          git_bash: { cwd: ".", args: ["../../git-bash-mcp/dist/cli.js", "mcp"] },
          lsp: { cwd: ".", args: ["../../lsp-daemon/dist/cli.js", "mcp"] },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(cacheRoot, sourceRoot)

    // then
    const rewritten = JSON.parse(await readFile(join(cacheRoot, ".mcp.json"), "utf8")) as {
      mcpServers: {
        custom: { args: string[] }
        git_bash: { cwd?: string; args: string[] }
        lsp: { cwd?: string; args: string[] }
      }
    }
    expect(Object.keys(rewritten.mcpServers).sort()).toEqual(["custom", "git_bash", "lsp"])
    expect(rewritten.mcpServers.custom.args).toEqual(["/usr/local/bin/custom-mcp", "--stdio"])
    expect(rewritten.mcpServers.git_bash.cwd).toBeUndefined()
    expect(rewritten.mcpServers.git_bash.args[0]).toBe(join(cacheRoot, "components", "git-bash-mcp", "dist", "cli.js"))
    expect(rewritten.mcpServers.lsp.cwd).toBeUndefined()
    expect(rewritten.mcpServers.lsp.args[0]).toBe(join(cacheRoot, "components", "lsp-daemon", "dist", "cli.js"))
  })

  test("rewrites cached package file dependencies that point outside the plugin cache back to the source package", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "packages", "omo-codex", "plugin")
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "@scope/omo",
        version: "0.1.0",
        dependencies: { "@scope/lsp-tools": "file:../lsp-tools-mcp" },
      }),
    )
    await writeFile(
      join(sourceRoot, "package-lock.json"),
      JSON.stringify({
        name: "@scope/omo",
        version: "0.1.0",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "@scope/omo",
            version: "0.1.0",
            dependencies: { "@scope/lsp-tools": "file:../lsp-tools-mcp" },
          },
          "../lsp-tools-mcp": { name: "@scope/lsp-tools", version: "0.1.0" },
          "node_modules/@scope/lsp-tools": {
            resolved: "../lsp-tools-mcp",
            link: true,
          },
        },
      }),
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
    const cachedPackageJson = JSON.parse(await readFile(join(installed.path, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    const sourceDependencyPath = join(root, "packages", "omo-codex", "lsp-tools-mcp")
    const packageLockDependencyPath = relative(realpathSync(installed.path), sourceDependencyPath).split(sep).join("/")
    expect(cachedPackageJson.dependencies["@scope/lsp-tools"]).toBe(`file:${sourceDependencyPath}`)
    const cachedPackageLock = JSON.parse(await readFile(join(installed.path, "package-lock.json"), "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string>; resolved?: string }>
    }
    expect(cachedPackageLock.packages[""]?.dependencies?.["@scope/lsp-tools"]).toBe(`file:${sourceDependencyPath}`)
    expect(cachedPackageLock.packages[packageLockDependencyPath]).toEqual({ name: "@scope/lsp-tools", version: "0.1.0" })
    expect(cachedPackageLock.packages["node_modules/@scope/lsp-tools"]?.resolved).toBe(packageLockDependencyPath)
  })

  test("#given source plugin has an npm lockfile #when caching plugin #then lockfile is preserved for deterministic install", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-lockfile-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    const lockfile = '{"packages":{"components/ulw-loop":{}}}\n'
    await writeFile(join(sourceRoot, "package-lock.json"), lockfile)

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
    expect(await readFile(join(installed.path, "package-lock.json"), "utf8")).toBe(lockfile)
  })

  test("#given stale sparkshell guidance in prompt surfaces #when caching plugin #then cache promotion is rejected", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-sparkshell-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    await mkdir(join(sourceRoot, "skills", "ulw-loop", "references"), { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(
      join(sourceRoot, "skills", "ulw-loop", "references", "full-workflow.md"),
      "After compaction, run `omo sparkshell cat .omo/ulw-loop/ledger.jsonl` first.\n",
    )

    // when / then
    await expect(
      installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async () => undefined,
      }),
    ).rejects.toThrow(/removed sparkshell/i)
    await expect(stat(join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0"))).rejects.toThrow()
  })

  test("#given stale sparkshell guidance in component prompt surfaces #when caching plugin #then cache promotion is rejected", async () => {
    // given
    const promptCases = [
      join("components", "ulw-loop", "agents", "planner.toml"),
      join("components", "ulw-loop", "bundled-rules", "rules.md"),
      join("components", "ulw-loop", "hooks", "session-start.json"),
      join("components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
    ]

    for (const promptCase of promptCases) {
      const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-component-sparkshell-"))
      const codexHome = join(root, "codex-home")
      const sourceRoot = join(root, "plugin")
      const stalePrompt = join(sourceRoot, promptCase)
      await mkdir(dirname(stalePrompt), { recursive: true })
      await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
      await writeFile(stalePrompt, "After compaction, run `omo sparkshell cat .omo/ulw-loop/ledger.jsonl` first.\n")

      // when / then
      await expect(
        installCachedPlugin({
          codexHome,
          marketplaceName: "debug",
          name: "omo",
          sourcePath: sourceRoot,
          version: "0.1.0",
          runCommand: async () => undefined,
        }),
      ).rejects.toThrow(/removed sparkshell/i)
      await expect(stat(join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0"))).rejects.toThrow()
    }
  })

  test("#given existing cache #when npm install fails #then previous active cache is preserved", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-install-fail-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0")
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))

    // when
    await expect(
      installCachedPlugin({
        codexHome,
        marketplaceName: "debug",
        name: "omo",
        sourcePath: sourceRoot,
        version: "0.1.0",
        runCommand: async (_command, args) => {
          if (args.join(" ") === "ci --omit=dev") throw new Error("spawn npm ENOENT")
        },
      }),
    ).rejects.toThrow("spawn npm ENOENT")

    // then
    expect(await readFile(join(cacheRoot, "package.json"), "utf8")).toBe(JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))
    expect(await readdir(join(codexHome, "plugins", "cache", "debug", "omo"))).toEqual(["0.1.0"])
  })

  test("#given existing cache #when final promotion fails #then previous active cache is restored", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-promote-fail-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0")
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
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
        renameDirectory: async (fromPath, toPath) => {
          if (toPath === cacheRoot && basename(fromPath).startsWith(".tmp-")) throw new Error("rename final failed")
          await rename(fromPath, toPath)
        },
      }),
    ).rejects.toThrow("rename final failed")

    // then
    expect(await readFile(join(cacheRoot, "package.json"), "utf8")).toBe(JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))
    expect(await readdir(join(codexHome, "plugins", "cache", "debug", "omo"))).toEqual(["0.1.0"])
  })

  test("#given source plugin has built component runtimes #when caching plugin #then component dist files are preserved for hooks", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-component-dist-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const componentRoot = join(sourceRoot, "components", "rules")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

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
    expect((await stat(join(installed.path, "components", "rules", "dist", "cli.js"))).isFile()).toBe(true)
  })

  test("#given packaged root CLI runtimes #when caching omo plugin #then root dist is materialized into the plugin cache", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-root-runtime-"))
    const repoRoot = join(root, "repo")
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin")
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
    await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(repoRoot, "dist", "cli", "index.js"), "console.log('omo')\n")
    await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), "console.log('omo node')\n")

    // when
    const installed = await installCachedPlugin({
      codexHome,
      marketplaceName: "sisyphuslabs",
      name: "omo",
      sourcePath: sourceRoot,
      version: "0.1.0",
      runCommand: async () => undefined,
    })

    // then
    expect(await readFile(join(installed.path, "dist", "cli", "index.js"), "utf8")).toBe("console.log('omo')\n")
    expect(await readFile(join(installed.path, "dist", "cli-node", "index.js"), "utf8")).toBe("console.log('omo node')\n")
  })

  test("links cached plugin bins and stays idempotent", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const first = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })
    const second = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    const linkedTarget = await readlink(join(binDir, "omo-hook"))
    expect(linkedTarget).toBe(join(pluginRoot, "dist", "cli.js"))
  })

  test("#given nested component declares reserved omo bin #when linking cached plugin bins #then skips the nested top-level command", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-reserved-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "ulw-loop")
    const binDir = join(root, "bin")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(
      join(componentRoot, "package.json"),
      JSON.stringify({
        name: "@scope/ulw-loop",
        bin: {
          omo: "dist/cli.js",
          "omo-ulw-loop": "dist/cli.js",
          ulw: "dist/cli.js",
          "ulw-loop": "dist/cli.js",
        },
      }),
    )
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(linked).toEqual([
      { name: "omo-ulw-loop", path: join(binDir, "omo-ulw-loop"), target: join(componentRoot, "dist", "cli.js") },
      { name: "ulw", path: join(binDir, "ulw"), target: join(componentRoot, "dist", "cli.js") },
      { name: "ulw-loop", path: join(binDir, "ulw-loop"), target: join(componentRoot, "dist", "cli.js") },
    ])
    await expect(readlink(join(binDir, "omo"))).rejects.toThrow()
    expect(await readlink(join(binDir, "omo-ulw-loop"))).toBe(join(componentRoot, "dist", "cli.js"))
    expect(await readlink(join(binDir, "ulw"))).toBe(join(componentRoot, "dist", "cli.js"))
    expect(await readlink(join(binDir, "ulw-loop"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given stale managed ulw-loop omo symlink #when linking cached plugin bins #then removes it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-stale-omo-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "rules")
    const binDir = join(root, "bin")
    const oldTarget = join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await mkdir(join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist"), {
      recursive: true,
    })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(oldTarget, "#!/usr/bin/env node\n")
    await symlink(oldTarget, join(binDir, "omo"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    await expect(readlink(join(binDir, "omo"))).rejects.toThrow()
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given stale local-source ulw-loop omo symlink #when linking cached plugin bins #then removes it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-source-omo-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "rules")
    const binDir = join(root, "bin")
    const oldTarget = join(root, "repo", "packages", "omo-codex", "plugin", "components", "ulw-loop", "dist", "cli.js")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await mkdir(join(root, "repo", "packages", "omo-codex", "plugin", "components", "ulw-loop", "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(oldTarget, "#!/usr/bin/env node\n")
    await symlink(oldTarget, join(binDir, "omo"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    await expect(readlink(join(binDir, "omo"))).rejects.toThrow()
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given stale public ulw symlink points at deleted cache payload #when linking cached plugin bins #then removes the dangling managed link", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-stale-ulw-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "rules")
    const ulwLoopRoot = join(pluginRoot, "components", "ulw-loop")
    const binDir = join(root, "bin")
    const oldTarget = join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "9.9.9", "components", "ulw-loop", "dist", "cli.js")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await mkdir(join(ulwLoopRoot, "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(ulwLoopRoot, "package.json"), JSON.stringify({ name: "@scope/ulw-loop", bin: { ulw: "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(join(ulwLoopRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await symlink(oldTarget, join(binDir, "ulw"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(await readlink(join(binDir, "ulw"))).toBe(join(ulwLoopRoot, "dist", "cli.js"))
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given dangling symlink points at another cached plugin #when linking cached plugin bins #then preserves it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-other-plugin-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "rules")
    const binDir = join(root, "bin")
    const otherTarget = join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "other-plugin", "9.9.9", "components", "tool", "dist", "cli.js")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await symlink(otherTarget, join(binDir, "other-tool"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(await readlink(join(binDir, "other-tool"))).toBe(otherTarget)
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given non-managed bin points at deleted omo cache payload #when linking cached plugin bins #then preserves the user symlink", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-user-omo-shaped-bin-"))
    const pluginRoot = join(root, "plugin")
    const componentRoot = join(pluginRoot, "components", "rules")
    const binDir = join(root, "bin")
    const userTarget = join(root, "codex-home", "plugins", "cache", "sisyphuslabs", "omo", "9.9.9", "components", "rules", "dist", "cli.js")
    await mkdir(join(componentRoot, "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo" }))
    await writeFile(join(componentRoot, "package.json"), JSON.stringify({ name: "@scope/rules", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(componentRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await symlink(userTarget, join(binDir, "user-tool"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(await readlink(join(binDir, "user-tool"))).toBe(userTarget)
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(componentRoot, "dist", "cli.js"))
  })

  test("#given legacy codex-prefixed component symlinks #when linking cached plugin bins #then removes stale managed symlinks without touching user files", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-legacy-bins-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    const oldTarget = join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "rules", "dist", "cli.js")
    const oldLspTarget = join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "lsp", "dist", "cli.js")
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await mkdir(join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "rules", "dist"), { recursive: true })
    await mkdir(join(root, "codex-home", "plugins", "cache", "legacy-market", "omo", "0.0.1", "components", "lsp", "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(oldTarget, "#!/usr/bin/env node\n")
    await writeFile(oldLspTarget, "#!/usr/bin/env node\n")
    await symlink(oldTarget, join(binDir, "codex-rules"))
    await symlink(oldLspTarget, join(binDir, "codex-lsp"))
    await writeFile(join(binDir, "codex-comment-checker"), "user managed file\n")

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    await expect(readlink(join(binDir, "codex-rules"))).rejects.toThrow()
    await expect(readlink(join(binDir, "codex-lsp"))).rejects.toThrow()
    expect(await readFile(join(binDir, "codex-comment-checker"), "utf8")).toBe("user managed file\n")
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(pluginRoot, "dist", "cli.js"))
  })

  test("#given user-owned codex-prefixed symlink #when linking cached plugin bins #then preserves the user symlink", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-user-symlink-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    const userTarget = join(root, "user-tools", "codex-rules")
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await mkdir(join(root, "user-tools"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(userTarget, "#!/usr/bin/env node\n")
    await symlink(userTarget, join(binDir, "codex-rules"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(await readlink(join(binDir, "codex-rules"))).toBe(userTarget)
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(pluginRoot, "dist", "cli.js"))
  })

  test("#given user-owned codex symlink with component-like target #when linking cached plugin bins #then preserves the user symlink", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-user-component-symlink-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    const userTarget = join(root, "workspace", "components", "rules", "dist", "cli.js")
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await mkdir(join(root, "workspace", "components", "rules", "dist"), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-rules": "dist/cli.js" } }))
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(userTarget, "#!/usr/bin/env node\n")
    await symlink(userTarget, join(binDir, "codex-rules"))

    // when
    await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(await readlink(join(binDir, "codex-rules"))).toBe(userTarget)
    expect(await readlink(join(binDir, "omo-rules"))).toBe(join(pluginRoot, "dist", "cli.js"))
  })

  test("writes Windows command shims for cached plugin bins", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" })

    // then
    expect(linked).toEqual([{ name: "omo-hook", path: join(binDir, "omo-hook.cmd"), target: join(pluginRoot, "dist", "cli.js") }])
    const commandShim = await readFile(join(binDir, "omo-hook.cmd"), "utf8")
    expect(commandShim).toContain("@echo off")
    expect(commandShim).toContain("NODE_REPL_NODE_PATH")
    expect(commandShim).toContain('"%OMO_NODE_BINARY%" "')
    expect(commandShim).not.toContain(BROKEN_WINDOWS_DOUBLE_QUOTE_TRIM)
    expect(commandShim).toContain(`"${join(pluginRoot, "dist", "cli.js")}" %*`)
    expect(commandShim).not.toContain(`node "${join(pluginRoot, "dist", "cli.js")}" %*`)
  })

  test("rejects existing non-generated Windows command shims", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(join(binDir, "omo-hook.cmd"), "@echo off\r\necho custom\r\n")

    // when
    let rejected = false
    try {
      await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("already exists and is not a generated command shim")
    }

    // then
    expect(rejected).toBe(true)
    expect(await readFile(join(binDir, "omo-hook.cmd"), "utf8")).toContain("echo custom")
  })
})
