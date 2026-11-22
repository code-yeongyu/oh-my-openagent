import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { collectPluginState } from "./fused-equivalence-plugin-state.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sandbox(files) {
  const dir = mkdtempSync(join(tmpdir(), "eq-plugin-state-"))
  roots.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return { box: { agentDir: join(dir, "agent") }, env: { OMO_MEMORY_HOME: join(dir, "memory") } }
}

describe("collectPluginState", () => {
  test("#given a memory repo and a task record #when collected #then both are observed and git internals and runtime scratch are not", () => {
    const run = sandbox({
      "memory/agents/work-0123abcd/repo/system/eq-facts.md": "fact\n",
      "memory/agents/work-0123abcd/repo/.git/HEAD": "ref: refs/heads/main\n",
      "memory/agents/work-0123abcd/runtime/locks/git-activity.flock": "",
      "agent/projects/work-1/senpi-task/tasks/st_0000000b.json": JSON.stringify({
        task_id: "st_0000000b",
        background_mode: "foreground",
      }),
      "agent/projects/work-1/senpi-task/tasks/st_0000000a.json": JSON.stringify({
        task_id: "st_0000000a",
        background_mode: "background",
      }),
      "agent/projects/work-1/senpi-task/logs/st_0000000a.jsonl": "{}\n",
    })

    expect(collectPluginState(run)).toEqual({
      memory: [{ identity: "work-0123abcd", files: { "repo/system/eq-facts.md": { text: "fact\n" } } }],
      tasks: [
        { task_id: "st_0000000a", background_mode: "background" },
        { task_id: "st_0000000b", background_mode: "foreground" },
      ],
    })
  })

  test("#given a memory repo under a renamed directory #when collected #then the renamed path is what is observed", () => {
    const run = sandbox({ "memory/agents/work-0123abcd/repo-x/system/eq-facts.md": "fact\n" })

    expect(collectPluginState(run).memory[0].files).toEqual({ "repo-x/system/eq-facts.md": { text: "fact\n" } })
  })

  test("#given a sandbox where the plugin wrote nothing #when collected #then the state is empty, not an error", () => {
    expect(collectPluginState(sandbox({}))).toEqual({ memory: [], tasks: [] })
  })
})
