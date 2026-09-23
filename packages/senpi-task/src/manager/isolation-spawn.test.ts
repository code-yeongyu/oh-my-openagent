import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import { buildCompletionDetails, completionMessageLines } from "../completion"
import type { DagNodeId, DagRunId } from "../dag/types"
import { recordDetails } from "../tools/task/result-details"
import {
  WritingRunner,
  cleanupIsolationProjects,
  isolatedSpec,
  isolationSettings,
  makeIsolationManager,
  tempGitRepo,
} from "./__fixtures__/isolation-fakes"
import { flush } from "./__fixtures__/manager-fakes"

afterEach(cleanupIsolationProjects)

async function startAndSettle(manager: ReturnType<typeof makeIsolationManager>["manager"], spec = isolatedSpec()) {
  const started = await manager.start(spec)
  expect(started.kind).toBe("started")
  if (started.kind !== "started") throw new Error("spawn refused")
  return started
}

describe("isolated child spawn", () => {
  test("#given an isolated child that writes a file #when it completes #then the write lands in the parent checkout and the clone is gone", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner([{ path: "a.txt", content: "from the child\n" }])
    const { manager, store } = makeIsolationManager({ fixture, runner })

    const started = await startAndSettle(manager)
    const spawned = runner.startedSpecs[0]
    expect(spawned?.cwd).not.toBe(fixture.repoRoot)
    expect(existsSync(join(fixture.repoRoot, "a.txt"))).toBe(false)

    const terminal = manager.waitFor(started.task_id)
    runner.settle(started.task_id, { status: "completed", finalResponse: "done" })
    const record = await terminal

    expect(readFileSync(join(fixture.repoRoot, "a.txt"), "utf8")).toBe("from the child\n")
    expect(record.isolation?.merge_result?.kind).toBe("applied")
    expect(record.isolation?.merge_result?.changesApplied).toBe(true)
    expect(typeof record.isolation?.merge_result?.duration_ms).toBe("number")
    expect(existsSync(record.isolation?.base_dir ?? "")).toBe(false)
    expect(store.load(started.task_id)?.isolation?.merge_result?.kind).toBe("applied")
  })

  test("#given a completed isolated child #when the completion notification is built #then its details and rendered line carry the isolation outcome", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner([{ path: "a.txt", content: "child\n" }])
    const { manager } = makeIsolationManager({ fixture, runner })
    const started = await startAndSettle(manager)
    const terminal = manager.waitFor(started.task_id)
    runner.settle(started.task_id, { status: "completed", finalResponse: "done" })
    const record = await terminal

    const details = buildCompletionDetails(record)
    expect(details.isolation?.kind).toBe("applied")
    expect(details.isolation?.changes_applied).toBe(true)
    expect(details.isolation?.backend.length).toBeGreaterThan(0)
    expect((details.isolation?.summary_path ?? "").length).toBeGreaterThan(0)
    expect(completionMessageLines([details]).join("\n")).toContain(`isolation: applied via ${details.isolation?.backend}`)

    const toolDetails = recordDetails(record, "spawn")
    expect(toolDetails.isolation?.kind).toBe("applied")
    expect(toolDetails.isolation?.files_changed).toBeGreaterThan(0)
  })

  test("#given the parent edited the same file during the run #when the child completes #then nothing is applied and the workspace is retained beside its patch", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner([{ path: "seed.txt", content: "child edit\n" }])
    const { manager } = makeIsolationManager({ fixture, runner })
    const started = await startAndSettle(manager)
    writeFileSync(join(fixture.repoRoot, "seed.txt"), "parent edit\n")

    const terminal = manager.waitFor(started.task_id)
    runner.settle(started.task_id, { status: "completed", finalResponse: "done" })
    const record = await terminal

    expect(record.isolation?.merge_result?.kind).toBe("not-applied")
    expect(record.isolation?.merge_result?.changesApplied).toBe(false)
    expect(readFileSync(join(fixture.repoRoot, "seed.txt"), "utf8")).toBe("parent edit\n")
    expect(existsSync(record.isolation?.merge_result?.patchPath ?? "")).toBe(true)
    const base = record.isolation?.base_dir ?? ""
    const siblings = readdirSync(dirname(base))
    expect(siblings.some((entry) => entry.startsWith(`${basename(base)}.retained-`))).toBe(true)
  })

  test("#given an isolated child that is cancelled #when it settles #then the delta is retained as artifacts and nothing is merged", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner([{ path: "a.txt", content: "abandoned\n" }])
    const { manager } = makeIsolationManager({ fixture, runner })
    const started = await startAndSettle(manager)

    const terminal = manager.waitFor(started.task_id)
    runner.settle(started.task_id, { status: "cancelled" })
    const record = await terminal

    expect(record.status).toBe("cancelled")
    expect(record.isolation?.merge_result?.kind).toBe("retained")
    expect(record.isolation?.merge_result?.changesApplied).toBe(false)
    expect(existsSync(join(fixture.repoRoot, "a.txt"))).toBe(false)
    expect(existsSync(record.isolation?.merge_result?.patchPath ?? "")).toBe(true)
  })

  test("#given an isolated child that errors #when it settles #then the delta is retained and never merged", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner([{ path: "a.txt", content: "half done\n" }])
    const { manager } = makeIsolationManager({ fixture, runner })
    const started = await startAndSettle(manager)

    const terminal = manager.waitFor(started.task_id)
    runner.settle(started.task_id, { status: "error", failure: { kind: "child-turn-failed", message: "boom" } })
    const record = await terminal

    expect(record.status).toBe("error")
    expect(record.isolation?.merge_result?.kind).toBe("retained")
    expect(existsSync(join(fixture.repoRoot, "a.txt"))).toBe(false)
  })

  test("#given task.isolation.enabled #when a child spawns without the parameter #then it is isolated, and an explicit isolated:false overrides it", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner()
    const { manager } = makeIsolationManager({
      fixture,
      runner,
      config: isolationSettings({ isolation: { enabled: true } }),
    })

    const inherited = await manager.start({ prompt: "p", parent_session_id: "parent-1", depth: 1, category: "quick" })
    expect(inherited.kind).toBe("started")
    expect(runner.startedSpecs[0]?.cwd).not.toBe(fixture.repoRoot)

    const overridden = await manager.start({ prompt: "p", parent_session_id: "parent-1", depth: 1, category: "quick", isolated: false })
    expect(overridden.kind).toBe("started")
    expect(runner.startedSpecs[1]?.cwd).toBe(fixture.repoRoot)
    if (overridden.kind === "started") expect(manager.get(overridden.task_id)?.isolation).toBeUndefined()
  })

  test("#given a cwd that is not a git checkout #when an isolated child is requested #then the spawn is refused typed, no record stays running and the lease is released", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner()
    const { manager, store } = makeIsolationManager({
      fixture,
      runner,
      cwd: fixture.projectDir,
      config: isolationSettings({ default_concurrency: 1 }),
    })

    const refused = await manager.start(isolatedSpec())
    expect(refused.kind).toBe("start_failed")
    if (refused.kind !== "start_failed") throw new Error("expected a refusal")
    expect(refused.failure_kind).toBe("isolation_unavailable")
    expect(refused.error_message).toContain("not a git checkout")
    expect(runner.startedSpecs).toHaveLength(0)
    await flush()
    expect(store.list().records.every((record) => record.status !== "running")).toBe(true)

    const next = await manager.start({ prompt: "p", parent_session_id: "parent-1", depth: 1, category: "quick" })
    expect(next.kind).toBe("started")
    if (next.kind === "started") expect(next.status).toBe("running")
  })

  test("#given task.isolation.enabled #when a DAG node spawns through the manager #then the node runs in a clone without any per-node field", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner()
    const { manager, store } = makeIsolationManager({
      fixture,
      runner,
      config: isolationSettings({ isolation: { enabled: true } }),
    })

    const started = await manager.startOwned(
      { prompt: "node work", parent_session_id: "parent-1", depth: 1, category: "quick" },
      { kind: "dag", runId: "run-1" as DagRunId, nodeId: "node-a" as DagNodeId, fingerprint: "fp-1" },
    )

    expect(started.kind).toBe("started")
    if (started.kind !== "started") throw new Error("node spawn refused")
    expect(runner.startedSpecs[0]?.cwd).not.toBe(fixture.repoRoot)
    expect(store.load(started.task_id)?.spawn_spec?.cwd).toBe(store.load(started.task_id)?.isolation?.merged_dir)
  })

  test("#given a spawned isolated child #when its spawn spec is persisted #then the clone is recorded for a later rebuild and the baseline is on disk", async () => {
    const fixture = tempGitRepo()
    const runner = new WritingRunner()
    const { manager, store } = makeIsolationManager({ fixture, runner })
    const started = await startAndSettle(manager)
    const record = store.load(started.task_id)

    expect(record?.spawn_spec?.cwd).toBe(record?.isolation?.merged_dir)
    expect(record?.isolation?.mode).toBe("patch")
    expect(record?.isolation?.apply).toBe(true)
    expect(existsSync(join(store.stateDir, "isolation", started.task_id, "baseline.json"))).toBe(true)
  })
})
