/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeExistingCodexAgentFiles } from "./preserve-existing-codex-agents"

describe("materializeExistingCodexAgentFiles", () => {
  test("converts existing agent symlinks into regular files with their current content", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-preserve-agents-"))
    const codexHome = join(root, "codex")
    const agentsDir = join(codexHome, "agents")
    const snapshotAgent = join(root, "snapshot", "plan.toml")
    await mkdir(agentsDir, { recursive: true })
    await mkdir(join(root, "snapshot"), { recursive: true })
    await writeFile(snapshotAgent, 'name = "plan"\nmodel_reasoning_effort = "high"\n')
    await symlink(snapshotAgent, join(agentsDir, "plan.toml"))

    // when
    const materialized = await materializeExistingCodexAgentFiles(codexHome)
    await writeFile(snapshotAgent, 'name = "plan"\nmodel_reasoning_effort = "xhigh"\n')

    // then
    expect(materialized).toEqual([join(agentsDir, "plan.toml")])
    expect((await lstat(join(agentsDir, "plan.toml"))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(agentsDir, "plan.toml"), "utf8")).toBe('name = "plan"\nmodel_reasoning_effort = "high"\n')
  })
})
