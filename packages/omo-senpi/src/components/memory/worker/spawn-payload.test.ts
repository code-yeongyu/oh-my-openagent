import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import { prepareReflectionForkSpawn, prepareReflectionSpawn } from "./spawn-payload"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, { recursive: true, force: true })
)))

async function tempRoot(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-spawn-prefix-")))
  roots.push(root)
  return root
}

const run: ReservedRun = {
  runId: "run-prefix-1",
  request: { trigger: "manual", conversationIds: [], snapshots: [] },
}

const PREFIX = "/x/senpi/dist/cli-main.js"

describe("prepareReflectionSpawn", () => {
  test("#given an explicit senpiCommand and prefix args #when a reflection spawn is prepared #then the prefix appears in argv before print mode", async () => {
    // given
    const root = await tempRoot()

    // when
    const prepared = await prepareReflectionSpawn({
      run,
      worktree: {
        dir: root,
        commonConfigPath: join(root, "config"),
      } as unknown as ReflectionWorktree,
      reflectionSessionsDir: join(root, "sessions"),
      category: "quick",
      model: "provider/model",
      env: {},
      mergePolicy: "auto",
      skillsUsageSource: join(root, "skills.json"),
      dreamStateSource: join(root, "dream.json"),
      peoplePolicy: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      senpiCommand: "/usr/bin/node",
      senpiPrefixArgs: [PREFIX],
    })

    // then
    expect(prepared.command).toBe("/usr/bin/node")
    const prefixIndex = prepared.args.indexOf(PREFIX)
    const printIndex = prepared.args.indexOf("-p")
    expect(prefixIndex).toBeGreaterThanOrEqual(0)
    expect(printIndex).toBeGreaterThan(prefixIndex)
  }, 30_000)
})

describe("prepareReflectionForkSpawn", () => {
  test("#given an explicit senpiCommand and prefix args #when a fork-mode spawn is prepared #then the prefix appears in argv before print mode", async () => {
    // given
    const root = await tempRoot()

    // when
    const prepared = await prepareReflectionForkSpawn({
      run,
      worktree: {
        dir: root,
        commonConfigPath: join(root, "config"),
      } as unknown as ReflectionWorktree,
      reflectionSessionsDir: join(root, "sessions"),
      category: "quick",
      model: "provider/model",
      env: {},
      mergePolicy: "auto",
      skillsUsageSource: join(root, "skills.json"),
      dreamStateSource: join(root, "dream.json"),
      peoplePolicy: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      senpiCommand: "/usr/bin/node",
      senpiPrefixArgs: [PREFIX],
      parentSessionFile: join(root, "parent-session.jsonl"),
    })

    // then
    expect(prepared.command).toBe("/usr/bin/node")
    const prefixIndex = prepared.args.indexOf(PREFIX)
    const printIndex = prepared.args.indexOf("-p")
    const forkIndex = prepared.args.indexOf("--fork")
    expect(prefixIndex).toBeGreaterThanOrEqual(0)
    expect(printIndex).toBeGreaterThan(prefixIndex)
    expect(forkIndex).toBeGreaterThan(prefixIndex)
  }, 30_000)
})
