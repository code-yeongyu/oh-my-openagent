import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { syncSisyphusStateFromWorktree } from "./worktree-sync"

describe("syncSisyphusStateFromWorktree", () => {
  const BASE = join(tmpdir(), "worktree-sync-test-" + Date.now())
  const WORKTREE = join(BASE, "worktree")
  const MAIN_REPO = join(BASE, "main")

  beforeEach(() => {
    mkdirSync(WORKTREE, { recursive: true })
    mkdirSync(MAIN_REPO, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(BASE)) {
      rmSync(BASE, { recursive: true, force: true })
    }
  })

  test("#given no .sisyphus in worktree #when syncing #then returns true without error", () => {
    const result = syncSisyphusStateFromWorktree(WORKTREE, MAIN_REPO)

    expect(result).toBe(true)
    expect(existsSync(join(MAIN_REPO, ".sisyphus"))).toBe(false)
  })

  test("#given .sisyphus with boulder.json in worktree #when syncing #then copies to main repo", () => {
    const worktreeSisyphus = join(WORKTREE, ".sisyphus")
    mkdirSync(worktreeSisyphus, { recursive: true })
    writeFileSync(join(worktreeSisyphus, "boulder.json"), '{"active_plan":"/plan.md","plan_name":"test"}')

    const result = syncSisyphusStateFromWorktree(WORKTREE, MAIN_REPO)

    expect(result).toBe(true)
    const copied = readFileSync(join(MAIN_REPO, ".sisyphus", "boulder.json"), "utf-8")
    expect(JSON.parse(copied).plan_name).toBe("test")
  })

  test("#given nested .sisyphus dirs in worktree #when syncing #then copies full tree recursively", () => {
    const worktreePlans = join(WORKTREE, ".sisyphus", "plans")
    const worktreeNotepads = join(WORKTREE, ".sisyphus", "notepads", "my-plan")
    mkdirSync(worktreePlans, { recursive: true })
    mkdirSync(worktreeNotepads, { recursive: true })
    writeFileSync(join(worktreePlans, "my-plan.md"), "- [x] Task 1\n- [ ] Task 2")
    writeFileSync(join(worktreeNotepads, "learnings.md"), "learned something")

    const result = syncSisyphusStateFromWorktree(WORKTREE, MAIN_REPO)

    expect(result).toBe(true)
    expect(readFileSync(join(MAIN_REPO, ".sisyphus", "plans", "my-plan.md"), "utf-8")).toContain("Task 1")
    expect(readFileSync(join(MAIN_REPO, ".sisyphus", "notepads", "my-plan", "learnings.md"), "utf-8")).toBe("learned something")
  })

  test("#given existing .sisyphus in main repo #when syncing #then worktree state overwrites stale state", () => {
    const mainSisyphus = join(MAIN_REPO, ".sisyphus")
    mkdirSync(mainSisyphus, { recursive: true })
    writeFileSync(join(mainSisyphus, "boulder.json"), '{"plan_name":"old"}')

    const worktreeSisyphus = join(WORKTREE, ".sisyphus")
    mkdirSync(worktreeSisyphus, { recursive: true })
    writeFileSync(join(worktreeSisyphus, "boulder.json"), '{"plan_name":"updated"}')

    const result = syncSisyphusStateFromWorktree(WORKTREE, MAIN_REPO)

    expect(result).toBe(true)
    const content = readFileSync(join(mainSisyphus, "boulder.json"), "utf-8")
    expect(JSON.parse(content).plan_name).toBe("updated")
  })

  test("#given pre-existing files in main .sisyphus #when syncing #then preserves files not in worktree", () => {
    const mainSisyphus = join(MAIN_REPO, ".sisyphus", "rules")
    mkdirSync(mainSisyphus, { recursive: true })
    writeFileSync(join(mainSisyphus, "my-rule.md"), "existing rule")

    const worktreeSisyphus = join(WORKTREE, ".sisyphus")
    mkdirSync(worktreeSisyphus, { recursive: true })
    writeFileSync(join(worktreeSisyphus, "boulder.json"), '{"plan_name":"new"}')

    const result = syncSisyphusStateFromWorktree(WORKTREE, MAIN_REPO)

    expect(result).toBe(true)
    expect(readFileSync(join(MAIN_REPO, ".sisyphus", "rules", "my-rule.md"), "utf-8")).toBe("existing rule")
    expect(existsSync(join(MAIN_REPO, ".sisyphus", "boulder.json"))).toBe(true)
  })
})
