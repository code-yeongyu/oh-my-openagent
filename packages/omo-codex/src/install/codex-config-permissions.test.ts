/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureAutonomousPermissions } from "./codex-config-permissions"
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

test("#given config with legacy top-level network_access #when ensuring autonomous permissions #then removes the unsupported root key", () => {
  // given
  const config = [
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    'network_access = "enabled"',
    "",
    "[notice]",
    "hide_rate_limit_model_nudge = true",
    "",
  ].join("\n")

  // when
  const next = ensureAutonomousPermissions(config)

  // then
  expect(next).not.toMatch(/^\s*network_access\s*=/m)
  expect(next).not.toContain("[sandbox_workspace_write]")
  expect(next).toContain('approval_policy = "never"')
  expect(next).toContain('sandbox_mode = "danger-full-access"')
  expect(next).toContain("hide_rate_limit_model_nudge = true")
})
