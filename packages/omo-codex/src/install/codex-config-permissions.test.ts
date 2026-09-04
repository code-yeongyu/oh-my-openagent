/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

const posixTest = process.platform === "win32" ? test.skip : test

posixTest("#given unreadable existing config #when updating config #then rejects and preserves content", async () => {
  // given
  const root = await mkdtemp(join(tmpdir(), "omo-codex-config-unreadable-"))
  const configPath = join(root, "config.toml")
  const originalContent = ['[user]', 'important = "keep"', ""].join("\n")
  await writeFile(configPath, originalContent)
  await chmod(configPath, 0o200)

  // when
  let rejected = false
  try {
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })
  } catch (error) {
    if (error instanceof Error) rejected = true
    else throw error
  } finally {
    await chmod(configPath, 0o600)
  }

  // then
  const content = await readFile(configPath, "utf8")
  expect(rejected).toBe(true)
  expect(content).toBe(originalContent)
})
