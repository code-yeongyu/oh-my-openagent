/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncLazycodexMarketplace } from "./sync-lazycodex-marketplace"

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeRuntimeFile(path: string, label: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(label)});\n`)
}

async function writeMarketplaceFixture(sourceRoot: string, includeRootCli: boolean): Promise<void> {
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
            },
          ],
        },
      ],
    },
  })
  await writeRuntimeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "bootstrap", "dist", "cli.js"), "bootstrap")
  await writeRuntimeFile(join(sourceRoot, "packages", "git-bash-mcp", "dist", "cli.js"), "git-bash")
  await writeRuntimeFile(join(sourceRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"), "lsp-tools")
  await writeRuntimeFile(join(sourceRoot, "packages", "lsp-daemon", "dist", "cli.js"), "lsp-daemon")
  if (!includeRootCli) return
  await writeRuntimeFile(join(sourceRoot, "dist", "cli", "index.js"), "omo bun runtime")
  await writeRuntimeFile(join(sourceRoot, "dist", "cli-node", "index.js"), "omo node runtime")
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe("sync-lazycodex-marketplace root CLI payload", () => {
  test("#given root CLI dists #when syncing marketplace #then the plugin payload carries the omo runtime targets", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-root-cli-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-root-cli-lazycodex-"))
    await writeMarketplaceFixture(sourceRoot, true)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    const bunRuntime = join(lazycodexRoot, "plugins", "omo", "dist", "cli", "index.js")
    const nodeRuntime = join(lazycodexRoot, "plugins", "omo", "dist", "cli-node", "index.js")
    expect((await stat(bunRuntime)).isFile()).toBe(true)
    expect((await stat(nodeRuntime)).isFile()).toBe(true)
    await expect(readOptionalFile(bunRuntime)).resolves.toContain("omo bun runtime")
    await expect(readOptionalFile(nodeRuntime)).resolves.toContain("omo node runtime")
  })

  test("#given missing root CLI dist #when syncing marketplace #then validation rejects the broken payload", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-root-cli-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-root-cli-lazycodex-"))
    await writeMarketplaceFixture(sourceRoot, false)

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing built OMO root CLI dist")
    expect(message).toContain(join("dist", "cli"))
  })
})
