/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { windowsCommandShim } from "./codex-cache-command-shim"

async function createShimFixture(configuredNodePath: string): Promise<{ shimPath: string; codexHome: string }> {
  const root = mkdtempSync(join(tmpdir(), "omo-command-shim-"))
  const codexHome = join(root, "codex-home")
  await mkdir(codexHome, { recursive: true })
  await writeFile(
    join(codexHome, "config.toml"),
    `NODE_REPL_NODE_PATH = "${configuredNodePath.replace(/\\/g, "\\\\")}"\n`
  )

  const targetPath = join(root, "target.js")
  await writeFile(targetPath, 'process.stdout.write("shim-ran " + process.argv.slice(2).join(" "))\n')

  const shimPath = join(root, "omo-probe.cmd")
  await writeFile(shimPath, windowsCommandShim(targetPath))
  return { shimPath, codexHome }
}

describe("windows command shim", () => {
  it(
    "#given config.toml supplies NODE_REPL_NODE_PATH #when the shim runs #then cmd parses it and reaches the target",
    async () => {
      // given
      if (process.platform !== "win32") {
        return
      }
      const nodePath = process.execPath.replace(/bun\.exe$/i, "node.exe")
      const fixture = await createShimFixture(nodePath)

      // when
      const child = Bun.spawnSync(["cmd.exe", "/c", fixture.shimPath, "hello"], {
        env: { ...Bun.env, CODEX_HOME: fixture.codexHome },
      })

      // then
      expect(child.stderr.toString()).not.toContain("The syntax of the command is incorrect")
      expect(child.exitCode).toBe(0)
      expect(child.stdout.toString()).toContain("shim-ran hello")
    }
  )

  it("#given the node discovery block #when the shim is generated #then it carries no caret-escaped quote comparison", () => {
    // given / when
    const shim = windowsCommandShim("C:\\probe\\target.js")

    // then
    expect(shim).not.toContain('=="^""')
  })
})
