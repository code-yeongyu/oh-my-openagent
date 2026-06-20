/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCachedPlugin } from "./codex-cache"

describe("codex-cache install", () => {
  test("#given source plugin has development-only directories #when caching plugin #then writes only the plugin payload under the versioned cache", async () => {
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
  })

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

  test("#given packaged plugin has stale aggregate skills #when caching plugin #then syncs skills after production dependencies install", async () => {
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
          await mkdir(join(options.cwd, "skills", "ultraresearch"), { recursive: true })
          await writeFile(join(options.cwd, "skills", "ultraresearch", "SKILL.md"), "---\nname: ultraresearch\n---\n")
        }
      },
    })

    // then
    expect(commands).toEqual(["npm ci --omit=dev", "npm run sync:skills"])
    expect(await readFile(join(installed.path, "skills", "ultraresearch", "SKILL.md"), "utf8")).toContain("name: ultraresearch")
  })
})
