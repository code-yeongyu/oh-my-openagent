import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateLazycodexPluginBundle } from "./lazycodex-marketplace-validation"

async function writePluginMcpManifest(pluginRoot: string, manifest: unknown): Promise<void> {
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, ".mcp.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

describe("lazycodex marketplace validation guards", () => {
  test("#given an array mcpServers manifest #when validating the plugin bundle #then the manifest is rejected", async () => {
    // given
    const pluginRoot = await mkdtemp(join(tmpdir(), "omo-marketplace-array-manifest-"))
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
