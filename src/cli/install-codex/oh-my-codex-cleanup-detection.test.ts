/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeOhMyCodexBeforeInstall } from "./install-codex"
import { exists } from "./oh-my-codex-cleanup-test-support"

describe("oh-my-codex cleanup command detection", () => {
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

  test("#given unrelated omx spoofs an oh-my-codex package path #when cleaning before install #then does not execute it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-spoofed-omx-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\n# spoof: /node_modules/oh-my-codex/bin/omx\n", { mode: 0o755 })

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

  test("#given file shim points at an executable oh-my-codex target #when cleaning before install #then removes without executing it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-file-shim-"))
    const binDir = join(root, "bin")
    const omxPath = join(binDir, "omx")
    const omxTarget = join(root, "node_modules", "oh-my-codex", "bin", "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await writeFile(omxTarget, "#!/bin/sh\n", { mode: 0o755 })
    await writeFile(omxPath, "#!/bin/sh\nexec node ../node_modules/oh-my-codex/bin/omx \"$@\"\n", { mode: 0o755 })

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
    expect(await exists(omxPath)).toBe(false)
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

  test("#given relative PATH entry contains omx #when cleaning before install #then ignores it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-relative-path-omx-"))
    const binDir = join(root, "relative-bin")
    const omxPath = join(binDir, "omx")
    const commands: string[] = []
    await mkdir(binDir, { recursive: true })
    await writeFile(omxPath, "#!/bin/sh\nexec node ../node_modules/oh-my-codex/bin/omx \"$@\"\n", { mode: 0o755 })

    // when
    await removeOhMyCodexBeforeInstall({
      codexHome: join(root, "codex-home"),
      env: { PATH: "relative-bin" },
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
    const omxTarget = join(root, "node_modules", "oh-my-codex", "bin", "omx")
    await mkdir(binDir, { recursive: true })
    await mkdir(join(root, "node_modules", "oh-my-codex", "bin"), { recursive: true })
    await writeFile(omxTarget, "@echo off\r\n", { mode: 0o755 })
    await writeFile(omxPath, "@echo off\r\nnode %dp0%\\..\\node_modules\\oh-my-codex\\bin\\omx %*\r\n", { mode: 0o755 })

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
