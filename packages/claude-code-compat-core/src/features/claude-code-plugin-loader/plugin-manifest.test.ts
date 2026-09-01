import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

describe("loadPluginManifest", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("#given both manifest layouts #when loading a manifest directly #then the Claude plugin layout wins", async () => {
    //#given
    const installPath = createTemporaryDirectory("omo-manifest-layout-")
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true })
    writeFileSync(
      join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "claude-layout", version: "2.0.0" }),
      "utf-8",
    )
    writeFileSync(
      join(installPath, "plugin.json"),
      JSON.stringify({ name: "root-layout", version: "1.0.0" }),
      "utf-8",
    )

    //#when
    const { loadPluginManifest } = await import(`./discovery?t=${Date.now()}-manifest-layout`)
    const manifest = loadPluginManifest(installPath)

    //#then
    expect(manifest?.name).toBe("claude-layout")
    expect(manifest?.version).toBe("2.0.0")
  })
})
