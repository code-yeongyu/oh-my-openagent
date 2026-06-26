import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateLazycodexPluginBundle } from "./lazycodex-marketplace-validation"

async function writePluginMcpManifest(pluginRoot: string, manifest: unknown): Promise<void> {
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, ".mcp.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function writeRootCliRuntime(pluginRoot: string): Promise<void> {
  await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true })
  await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "console.log('omo')\n")
  await mkdir(join(pluginRoot, "dist", "cli-node"), { recursive: true })
  await writeFile(join(pluginRoot, "dist", "cli-node", "index.js"), "console.log('omo node')\n")
}

describe("lazycodex marketplace validation guards", () => {
  test("#given root runtime dists #when validating the plugin bundle #then root omo runtime targets are accepted", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-root-runtime-"))
    await writeRootCliRuntime(pluginRoot)

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).resolves.toBeUndefined()
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  test("#given missing root runtime dist #when validating the plugin bundle #then the root omo runtime target is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-missing-root-runtime-"))
    await mkdir(join(pluginRoot, "dist", "cli-node"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli-node", "index.js"), "console.log('omo node')\n")

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).rejects.toThrow("missing root CLI runtime path: dist/cli/index.js")
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  test("#given zero-byte root runtime dist #when validating the plugin bundle #then the root omo runtime target is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-zero-root-runtime-"))
    await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "console.log('omo')\n")
    await mkdir(join(pluginRoot, "dist", "cli-node"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli-node", "index.js"), "")

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).rejects.toThrow("dist/cli-node/index.js is zero bytes")
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  test("#given a root per-hook manifest references a missing command #when validating the plugin bundle #then the target is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-root-hook-manifest-"))
    await writeRootCliRuntime(pluginRoot)
    await mkdir(join(pluginRoot, "hooks"), { recursive: true })
    await writeFile(
      join(pluginRoot, "hooks", "user-prompt-submit-loading-project-rules.json"),
      `${JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "${PLUGIN_ROOT}/missing-target.js",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    )

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).rejects.toThrow("missing hook command target")
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  test("#given an array mcpServers manifest #when validating the plugin bundle #then the manifest is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-array-manifest-"))
    await writeRootCliRuntime(pluginRoot)
    await writePluginMcpManifest(pluginRoot, { mcpServers: [] })

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).rejects.toThrow("mcpServers must be object")
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  test("#given an array root mcp manifest #when validating the plugin bundle #then the manifest is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-array-root-"))
    await writeRootCliRuntime(pluginRoot)
    await writePluginMcpManifest(pluginRoot, [])

    try {
      // when
      const validated = validateLazycodexPluginBundle(pluginRoot)

      // then
      await expect(validated).rejects.toThrow("invalid MCP manifest")
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })
})
