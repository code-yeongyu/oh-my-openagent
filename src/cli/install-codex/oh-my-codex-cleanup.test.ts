/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeOhMyCodexBeforeInstall } from "./install-codex"
import { exists } from "./oh-my-codex-cleanup-test-support"

describe("oh-my-codex cleanup before Codex install", () => {
  test("#given omx is installed #when cleaning before install #then removes oh-my-codex before continuing", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-omx-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const omxTarget = join(root, "lib", "node_modules", "oh-my-codex", "bin", "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "lib", "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await writeFile(omxTarget, "#!/bin/sh\n", { mode: 0o755 })
    await symlink(omxTarget, omxPath)

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome,
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(false)
  })

  test("#given cleanup confirmation approves #when cleaning before install #then asks once before removing omx", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-confirm-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const omxTarget = join(root, "lib", "node_modules", "oh-my-codex", "bin", "omx")
    const prompts: string[] = []
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "lib", "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await writeFile(omxTarget, "#!/bin/sh\n", { mode: 0o755 })
    await symlink(omxTarget, omxPath)

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome,
      confirmCleanup: async ({ omxPath: confirmedPath }) => {
        prompts.push(confirmedPath)
        return true
      },
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(prompts).toEqual([omxPath])
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(false)
  })

  test("#given cleanup confirmation declines #when cleaning before install #then aborts before removing anything", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-decline-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const omxTarget = join(root, "lib", "node_modules", "oh-my-codex", "bin", "omx")
    const pluginCache = join(codexHome, "plugins", "cache", "oh-my-codex-local")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "lib", "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await mkdir(pluginCache, { recursive: true })
    await mkdir(join(root, ".omx"), { recursive: true })
    await writeFile(omxTarget, "#!/bin/sh\n", { mode: 0o755 })
    await symlink(omxTarget, omxPath)
    await writeFile(join(pluginCache, "marker"), "plugin cache")

    // when
    let cleanupError = ""
    try {
      await removeOhMyCodexBeforeInstall({
        codexHome,
        confirmCleanup: async () => false,
        env: { PATH: binDir },
        platform: "linux",
        repoRoot: root,
        runCommand: async (command, args) => {
          commands.push([command, ...args].join(" "))
        },
      })
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(cleanupError).toContain("cleanup was not approved")
    expect(commands).toEqual([])
    expect(await exists(omxPath)).toBe(true)
    expect(await exists(pluginCache)).toBe(true)
    expect(await exists(join(root, ".omx"))).toBe(true)
  })

  test("#given omx is missing #when cleaning before install #then skips omx uninstall and removes the npm package", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-no-omx-cleanup-"))
    const commands: string[] = []

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: join(root, "missing-bin") },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
  })

  test("#given oh-my-codex residue exists #when cleaning before install #then removes known stale Codex cache only", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-residue-cleanup-"))
    const codexHome = join(root, "codex-home")
    const pluginCache = join(codexHome, "plugins", "cache", "oh-my-codex-local")
    const projectOmx = join(root, ".omx")
    await mkdir(pluginCache, { recursive: true })
    await mkdir(projectOmx, { recursive: true })
    await writeFile(join(pluginCache, "marker"), "plugin cache")
    await writeFile(join(projectOmx, "marker"), "project state")

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome,
      env: { PATH: join(root, "missing-bin") },
      platform: "linux",
      repoRoot: root,
      runCommand: async () => undefined,
    })

    // then
    expect(await exists(pluginCache)).toBe(false)
    expect(await exists(projectOmx)).toBe(true)
  })

  test("#given owned omx symlink remains #when cleaning before install #then removes npm package and residue", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-failing-omx-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const omxTarget = join(root, "lib", "node_modules", "oh-my-codex", "bin", "omx")
    const pluginCache = join(codexHome, "plugins", "cache", "oh-my-codex-local")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "lib", "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await mkdir(pluginCache, { recursive: true })
    await mkdir(join(root, ".omx"), { recursive: true })
    await writeFile(omxTarget, "#!/bin/sh\n", { mode: 0o755 })
    await symlink(omxTarget, omxPath)
    await writeFile(join(pluginCache, "marker"), "plugin cache")

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome,
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(pluginCache)).toBe(false)
    expect(await exists(join(root, ".omx"))).toBe(true)
    expect(await exists(omxPath)).toBe(false)
  })

})
