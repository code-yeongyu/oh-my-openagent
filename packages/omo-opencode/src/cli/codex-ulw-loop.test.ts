/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveCodexUlwLoopCommand } from "./codex-ulw-loop"

describe("Codex ulw-loop routing", () => {
  test("prefers the Codex-local omo-ulw-loop bin so a global omo can reach ulw-loop without recursion", () => {
    // given
    const root = join(tmpdir(), `omo-ulw-loop-${randomUUID()}`)
    const binDir = join(root, "bin")
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, "omo"), "#!/usr/bin/env node\n")
    writeFileSync(join(binDir, "omo-ulw-loop"), "#!/usr/bin/env node\n")

    // when
    const command = resolveCodexUlwLoopCommand({
      env: { CODEX_LOCAL_BIN_DIR: binDir },
      homeDir: root,
    })

    // then
    expect(command).toEqual({ executable: join(binDir, "omo-ulw-loop"), argsPrefix: [] })
  })

  test("falls back to the newest cached ulw-loop component cli", () => {
    // given
    const root = join(tmpdir(), `omo-ulw-loop-cache-${randomUUID()}`)
    const oldCli = join(root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    const newCli = join(root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "0.2.0", "components", "ulw-loop", "dist", "cli.js")
    mkdirSync(dirname(oldCli), { recursive: true })
    mkdirSync(dirname(newCli), { recursive: true })
    writeFileSync(oldCli, "#!/usr/bin/env node\n")
    writeFileSync(newCli, "#!/usr/bin/env node\n")

    // when
    const command = resolveCodexUlwLoopCommand({
      env: {},
      homeDir: root,
    })

    // then
    expect(command).toEqual({ executable: process.execPath, argsPrefix: [newCli] })
  })

  test("uses CODEX_HOME when selecting the newest cached ulw-loop component cli", () => {
    // given
    const root = join(tmpdir(), `omo-ulw-loop-codex-home-${randomUUID()}`)
    const codexHome = join(root, "codex-home")
    const homeDirCache = join(root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "9.9.9", "components", "ulw-loop", "dist", "cli.js")
    const codexHomeCache = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    mkdirSync(dirname(homeDirCache), { recursive: true })
    mkdirSync(dirname(codexHomeCache), { recursive: true })
    writeFileSync(homeDirCache, "#!/usr/bin/env node\n")
    writeFileSync(codexHomeCache, "#!/usr/bin/env node\n")

    // when
    const command = resolveCodexUlwLoopCommand({
      env: { CODEX_HOME: codexHome },
      homeDir: root,
    })

    // then
    expect(command).toEqual({ executable: process.execPath, argsPrefix: [codexHomeCache] })
  })

  test("skips the local omo bin when it points at the current CLI", () => {
    // given
    const root = join(tmpdir(), `omo-ulw-loop-self-${randomUUID()}`)
    const binDir = join(root, "bin")
    const selfBin = join(binDir, "omo")
    const componentCli = join(root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    mkdirSync(binDir, { recursive: true })
    mkdirSync(dirname(componentCli), { recursive: true })
    writeFileSync(selfBin, "#!/usr/bin/env node\n")
    writeFileSync(componentCli, "#!/usr/bin/env node\n")

    // when
    const command = resolveCodexUlwLoopCommand({
      env: { CODEX_LOCAL_BIN_DIR: binDir },
      homeDir: root,
      currentExecutablePaths: [selfBin],
    })

    // then
    expect(command).toEqual({ executable: process.execPath, argsPrefix: [componentCli] })
  })

  test("skips a root local omo wrapper and falls back to cached ulw-loop", () => {
    // given
    const root = join(tmpdir(), `omo-ulw-loop-root-wrapper-${randomUUID()}`)
    const binDir = join(root, "bin")
    const rootOmo = join(binDir, "omo")
    const componentCli = join(root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    mkdirSync(binDir, { recursive: true })
    mkdirSync(dirname(componentCli), { recursive: true })
    writeFileSync(rootOmo, "#!/bin/sh\nexec bun /repo/dist/cli/index.js \"$@\"\n")
    writeFileSync(componentCli, "#!/usr/bin/env node\n")

    // when
    const command = resolveCodexUlwLoopCommand({
      env: { CODEX_LOCAL_BIN_DIR: binDir },
      homeDir: root,
    })

    // then
    expect(command).toEqual({ executable: process.execPath, argsPrefix: [componentCli] })
  })
})
