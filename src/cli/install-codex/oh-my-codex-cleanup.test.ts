/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeOhMyCodexBeforeInstall } from "./install-codex"

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

describe("oh-my-codex cleanup before Codex install", () => {
  test("#given omx is installed #when cleaning before install #then removes oh-my-codex before continuing", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-omx-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\nexec node ../lib/node_modules/oh-my-codex/bin/omx \"$@\"\n", { mode: 0o755 })

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
    expect(commands).toEqual(["omx uninstall --purge", "npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(false)
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

  test("#given oh-my-codex residue exists #when cleaning before install #then removes known stale Codex artifacts", async () => {
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
    expect(await exists(projectOmx)).toBe(false)
  })

  test("#given owned omx uninstall fails #when cleaning before install #then still removes npm package and residue", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-failing-omx-cleanup-"))
    const codexHome = join(root, "codex-home")
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const pluginCache = join(codexHome, "plugins", "cache", "oh-my-codex-local")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(pluginCache, { recursive: true })
    await mkdir(join(root, ".omx"), { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\nexec node ../lib/node_modules/oh-my-codex/bin/omx \"$@\"\n", { mode: 0o755 })
    await writeFile(join(pluginCache, "marker"), "plugin cache")

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome,
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
        if (command === "omx") throw new Error("legacy uninstall failed")
      },
    })

    // then
    expect(commands).toEqual(["omx uninstall --purge", "npm uninstall -g oh-my-codex"])
    expect(await exists(pluginCache)).toBe(false)
    expect(await exists(join(root, ".omx"))).toBe(false)
    expect(await exists(omxPath)).toBe(false)
  })

  test("#given unrelated POSIX omx executable #when cleaning before install #then keeps it and continues", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-unrelated-posix-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\n# unrelated omx command\n", { mode: 0o755 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async () => undefined,
    })

    // then
    expect(await exists(omxPath)).toBe(true)
  })

  test("#given unrelated Windows omx command shim #when cleaning before install #then keeps it and continues", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-unrelated-windows-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx.CMD")
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "@echo off\r\nrem unrelated omx command\r\n", { mode: 0o755 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir, PATHEXT: ".CMD" },
      platform: "win32",
      repoRoot: root,
      runCommand: async () => undefined,
    })

    // then
    expect(await exists(omxPath)).toBe(true)
  })

  test("#given unrelated omx mentions oh-my-codex #when cleaning before install #then does not execute or delete it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-unrelated-mentioned-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\n# diagnostic: check whether oh-my-codex was removed\n", { mode: 0o755 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(true)
  })

  test("#given non executable omx file #when cleaning before install #then ignores it as a command", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-non-executable-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\nnode_modules/oh-my-codex/bin/omx\n", { mode: 0o644 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(true)
  })

  test("#given omx directory on PATH #when cleaning before install #then ignores it as a command", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-directory-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(omxPath, { recursive: true })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir },
      platform: "linux",
      repoRoot: root,
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "))
      },
    })

    // then
    expect(commands).toEqual(["npm uninstall -g oh-my-codex"])
    expect(await exists(omxPath)).toBe(true)
  })

  test("#given Windows omx command shim remains #when cleaning before install #then removes the cmd shim", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-windows-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx.CMD")
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "@echo off\r\nnode ..\\node_modules\\oh-my-codex\\bin\\omx %*\r\n", { mode: 0o755 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: binDir, PATHEXT: ".CMD" },
      platform: "win32",
      repoRoot: root,
      runCommand: async () => undefined,
    })

    // then
    expect(await exists(omxPath)).toBe(false)
  })
})
