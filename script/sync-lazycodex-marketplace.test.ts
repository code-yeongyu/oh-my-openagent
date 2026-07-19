/// <reference types="bun-types" />

// allow: SIZE_OK - marketplace sync tests exercise one release payload fixture tree; this release adds narrow assertions and future additions should split by payload section.

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncLazycodexMarketplace } from "./sync-lazycodex-marketplace"

const astGrepSkillSegments = ["ast", "grep"] as const
const astGrepSkillName = astGrepSkillSegments.join("-")
const astGrepMcpServerName = astGrepSkillSegments.join("_")
const deletedAstGrepRuntimeName = [...astGrepSkillSegments, "mcp"].join("-")

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

interface WritePluginFixtureOptions {
  readonly includeLazycodexRepositoryWorkflow?: boolean
}

async function writePluginFixture(sourceRoot: string, options: WritePluginFixtureOptions = {}): Promise<void> {
  await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
    name: "sisyphuslabs",
    plugins: [{ name: "omo", source: "./plugins/omo" }],
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), {
    name: "omo",
    version: "1.2.3",
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "package.json"), {
    name: "@sisyphuslabs/omo-codex-plugin",
    version: "1.2.3",
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "hooks", "hooks.json"), {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start',
              commandWindows:
                'powershell -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1"',
              timeout: 30,
              statusMessage: "LazyCodex(1.2.3): Checking Bootstrap Provisioning",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
              statusMessage: "LazyCodex(1.2.3): Checking Comments",
            },
          ],
        },
      ],
    },
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "hooks", "hooks.json"), {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start',
              commandWindows:
                'powershell -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1"',
              timeout: 30,
              statusMessage: "LazyCodex(1.2.3): Checking Bootstrap Provisioning",
            },
          ],
        },
      ],
    },
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", ".mcp.json"), {
    mcpServers: {
      lsp: { command: "node", args: ["../../../../lsp-daemon/dist/cli.js", "mcp"], cwd: "." },
    },
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".mcp.json"), {
    mcpServers: {
      git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"], cwd: "." },
      lsp: { command: "node", args: ["../../lsp-daemon/dist/cli.js", "mcp"], cwd: "." },
    },
  })
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "skills", astGrepSkillName), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "skills", astGrepSkillName, "SKILL.md"), "# AST-Grep\n")
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "README.md"), "omo\n")
  if (options.includeLazycodexRepositoryWorkflow ?? true) {
    await mkdir(join(sourceRoot, "packages", "omo-codex", "lazycodex-repository", ".github", "workflows"), { recursive: true })
    await writeFile(
      join(sourceRoot, "packages", "omo-codex", "lazycodex-repository", ".github", "workflows", "pr-source-guidance.yml"),
      "name: PR source guidance\n\non:\n  pull_request_target:\n",
    )
  }
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "comment-checker", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "comment-checker", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "scripts"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "scripts", "bootstrap.ps1"), "exit 0\n")
  await mkdir(join(sourceRoot, "packages", "git-bash-mcp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "git-bash-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "lsp-daemon", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "lsp-daemon", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "dist", "cli"), { recursive: true })
  await writeFile(join(sourceRoot, "dist", "cli", "index.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "dist", "cli-node"), { recursive: true })
  await writeFile(join(sourceRoot, "dist", "cli-node", "index.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored", "file.txt"), "ignored\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", ".ulw", "evidence"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", ".ulw", "evidence", "loop.json"), "{}\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", ".claude"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", ".claude", "settings.local.json"), "{}\n")
}

async function expectPathMissing(path: string): Promise<void> {
  let missing = false
  try {
    await stat(path)
  } catch (error) {
    missing = error instanceof Error
  }
  expect(missing).toBe(true)
}

describe("sync-lazycodex-marketplace", () => {
  test("#given marketplace sync #when copying plugin bundle #then emits self-contained mcp paths", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-lazycodex-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    const marketplace = JSON.parse(await readFile(join(lazycodexRoot, ".agents", "plugins", "marketplace.json"), "utf8"))
    expect(marketplace.name).toBe("sisyphuslabs")
    expect(marketplace.plugins[0].source).toBe("./plugins/omo")
    const manifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".codex-plugin", "plugin.json"), "utf8"))
    expect(manifest).toMatchObject({ name: "omo", version: "1.2.3" })
    const workflow = await readFile(join(lazycodexRoot, ".github", "workflows", "pr-source-guidance.yml"), "utf8")
    expect(workflow).toContain("PR source guidance")
    const mcpManifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".mcp.json"), "utf8"))
    expect(Object.hasOwn(mcpManifest.mcpServers, astGrepMcpServerName)).toBe(false)
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe("./components/git-bash-mcp/dist/cli.js")
    expect(mcpManifest.mcpServers.lsp.args[0]).toBe("./components/lsp-daemon/dist/cli.js")
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "components", deletedAstGrepRuntimeName))
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "skills", astGrepSkillName, "SKILL.md"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "git-bash-mcp", "dist", "cli.js"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "lsp-tools-mcp", "dist", "cli.js"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "lsp-daemon", "dist", "cli.js"))).isFile()).toBe(true)
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "node_modules"))
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", ".ulw"))
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", ".claude"))
  })

  test("#given marketplace sync #when copying the manifest #then also emits a root-level marketplace.json byte-identical to the source (lazycodex #139)", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-root-manifest-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-root-manifest-lazycodex-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    // Codex's `plugin marketplace add` scans only the repo ROOT for a supported manifest,
    // so the root copy must exist and stay byte-identical to both the source manifest and
    // the .agents/plugins/ copy. Its root-relative source must keep pointing at ./plugins/omo.
    const sourceManifest = await readFile(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), "utf8")
    const rootManifest = await readFile(join(lazycodexRoot, "marketplace.json"), "utf8")
    const nestedManifest = await readFile(join(lazycodexRoot, ".agents", "plugins", "marketplace.json"), "utf8")
    expect(rootManifest).toBe(sourceManifest)
    expect(rootManifest).toBe(nestedManifest)
    const parsed = JSON.parse(rootManifest)
    expect(parsed.name).toBe("sisyphuslabs")
    expect(parsed.plugins[0].source).toBe("./plugins/omo")
  })

  test("rejects a source tree without a Codex plugin manifest", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-lazycodex-"))
    await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
      name: "sisyphuslabs",
      plugins: [{ name: "omo", source: "./plugins/omo" }],
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing Codex plugin manifest")
  })

  test("#given older package payload without repository workflow #when syncing marketplace #then plugin bundle still syncs", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-old-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-old-lazycodex-"))
    await writePluginFixture(sourceRoot, { includeLazycodexRepositoryWorkflow: false })

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    const manifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".codex-plugin", "plugin.json"), "utf8"))
    expect(manifest).toMatchObject({ name: "omo", version: "1.2.3" })
    let workflowMissing = false
    try {
      await stat(join(lazycodexRoot, ".github", "workflows", "pr-source-guidance.yml"))
    } catch (error) {
      workflowMissing = error instanceof Error
    }
    expect(workflowMissing).toBe(true)
  }, 15_000)

  test("#given release version env #when syncing marketplace #then repository payload is stamped with release version", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-release-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-release-lazycodex-"))
    await writePluginFixture(sourceRoot)
    const previousReleaseVersion = process.env.LAZYCODEX_RELEASE_VERSION
    process.env.LAZYCODEX_RELEASE_VERSION = "4.7.9"
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "comment-checker", "hooks", "hooks.json"), {
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "${PLUGIN_ROOT}/components/comment-checker/dist/cli.js" hook post-tool-use',
                statusMessage: "LazyCodex(0.1.1): Checking Comments",
              },
            ],
          },
        ],
      },
    })

    try {
      // when
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } finally {
      if (previousReleaseVersion === undefined) {
        delete process.env.LAZYCODEX_RELEASE_VERSION
      } else {
        process.env.LAZYCODEX_RELEASE_VERSION = previousReleaseVersion
      }
    }

    // then
    const manifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".codex-plugin", "plugin.json"), "utf8"))
    const packageJson = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", "package.json"), "utf8"))
    const hooks = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", "hooks", "hooks.json"), "utf8"))
    const componentHooks = JSON.parse(
      await readFile(join(lazycodexRoot, "plugins", "omo", "components", "comment-checker", "hooks", "hooks.json"), "utf8"),
    )
    expect(manifest.version).toBe("4.7.9")
    expect(packageJson.version).toBe("4.7.9")
    expect(hooks.hooks.PostToolUse[0].hooks[0].statusMessage).toBe("LazyCodex(4.7.9): Checking Comments")
    expect(componentHooks.hooks.PostToolUse[0].hooks[0].statusMessage).toBe("LazyCodex(4.7.9): Checking Comments")
  })

  test("#given stale mcp runtime path #when syncing marketplace #then rejects the broken bundle", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-stale-mcp-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-stale-mcp-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".mcp.json"), {
      mcpServers: {
        lsp: { command: "node", args: ["./components/lsp/packages/lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." },
      },
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing MCP runtime path")
    expect(message).toContain("components/lsp/packages/lsp-tools-mcp/dist/cli.js")
  })

  test("#given missing hook command target #when syncing marketplace #then rejects the broken bundle", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-hook-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-hook-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node \"${PLUGIN_ROOT}/components/rules/dist/cli.js\" hook session-start",
              },
            ],
          },
        ],
      },
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing hook command target")
    expect(message).toContain("components/rules/dist/cli.js")
  })

  test("#given a previous payload without lsp-daemon dist #when syncing with allowMissingBundledDists #then reconstructs and skips the missing dist", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-prev-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-prev-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await rm(join(sourceRoot, "packages", "lsp-daemon", "dist"), { recursive: true, force: true })
    await rm(join(sourceRoot, "dist", "cli"), { recursive: true, force: true })
    await rm(join(sourceRoot, "dist", "cli-node"), { recursive: true, force: true })
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".mcp.json"), {
      mcpServers: {
        git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"], cwd: "." },
      },
    })

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot, allowMissingBundledDists: true })

    // then
    let daemonDistMissing = false
    try {
      await stat(join(lazycodexRoot, "plugins", "omo", "components", "lsp-daemon", "dist"))
    } catch (error) {
      daemonDistMissing = error instanceof Error
    }
    expect(daemonDistMissing).toBe(true)
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "dist", "cli", "index.js"))
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "dist", "cli-node", "index.js"))
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "lsp-tools-mcp", "dist", "cli.js"))).isFile()).toBe(true)
  })

  test("#given complete tree with bootstrap command and commandWindows targets #when syncing marketplace #then bundle validation passes", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-complete-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-complete-lazycodex-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "bootstrap", "dist", "cli.js"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "bootstrap", "scripts", "bootstrap.ps1"))).isFile()).toBe(true)
    // Codex reads MCP servers only from the plugin-root .mcp.json; a component's nested dev manifest
    // (whose relative daemon path dangles in the flattened bundle) must not ship in plugins/omo.
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "components", "lsp", ".mcp.json"))
  })

  test("#given missing bootstrap commandWindows target #when syncing marketplace #then rejects naming the bootstrap.ps1 path", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-ps1-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-ps1-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await rm(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "scripts", "bootstrap.ps1"))

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing hook command target")
    expect(message).toContain("components/bootstrap/scripts/bootstrap.ps1")
  })

  test("#given a zero-byte component dist #when syncing marketplace #then rejects it as zero bytes", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-zero-byte-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-zero-byte-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "comment-checker", "dist", "cli.js"), "")

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing hook command target")
    expect(message).toContain("components/comment-checker/dist/cli.js")
    expect(message).toContain("zero bytes")
  })

  test("#given a component ships a nested .mcp.json #when syncing marketplace #then it is dropped from the bundle and the sync succeeds", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-nested-mcp-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-nested-mcp-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", ".mcp.json"), {
      mcpServers: {
        lsp: { command: "node", args: ["./packages/lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." },
      },
    })

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    await expectPathMissing(join(lazycodexRoot, "plugins", "omo", "components", "lsp", ".mcp.json"))
  })

  test("#given multiple missing referenced targets #when syncing marketplace #then reports the full list", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-multi-missing-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-multi-missing-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await rm(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "dist"), { recursive: true, force: true })
    await rm(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "scripts"), { recursive: true, force: true })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing hook command target")
    expect(message).toContain("components/bootstrap/dist/cli.js")
    expect(message).toContain("components/bootstrap/scripts/bootstrap.ps1")
  })

  test("#given a missing lsp-daemon dist without the flag #then still hard-throws", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-strict-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-strict-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await rm(join(sourceRoot, "packages", "lsp-daemon", "dist"), { recursive: true, force: true })

    // when/then
    await expect(syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })).rejects.toThrow(/missing built LSP daemon dist/)
  })
})
