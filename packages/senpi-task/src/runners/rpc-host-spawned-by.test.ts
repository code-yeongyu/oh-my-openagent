import { afterEach, expect, test } from "bun:test"
import { createDagManager } from "../dag/manager"
import { createDagFileStore } from "../dag/store"
import { createDagScheduler } from "../dag/scheduler"
import { createRpcManagedRunner } from "../manager/runner"
import { baseSpec, cleanupProjects, launchSettled, makeManager, settings } from "../manager/__fixtures__/manager-fakes"
import { normalizeSenpiTeamSpec, spawnTeamMembers } from "../team"
import { bounded } from "../workpool/__fixtures__/admission"
import { hostRunnerHarness } from "./rpc-host.test-support"

const harness = hostRunnerHarness()
afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

async function fixture() {
  // A daemon on the pinned engine, which accepts open_session.spawnedBy (senpi#4205).
  const host = await harness.fakeHost({ engineVersion: "2026.10.25-2" })
  const rpc = harness.runnerOver(host)
  const managed = createRpcManagedRunner(rpc)
  const f = makeManager({
    process: managed,
    config: settings({ default_execution_mode: "process", max_depth: 6, default_concurrency: 1 }),
  })
  const ancestry = { parent_session_id: "nested-parent", root_session_id: "tree-root", depth: 3 }
  const check = (taskId: string, parentSessionId = ancestry.parent_session_id) => {
    const open = host.commands.find((command) =>
      command.type === "open_session" && String(command.payload.sessionPath).includes(taskId))
    expect(open?.payload.spawnedBy).toEqual({ parentSessionId, rootSessionId: "tree-root", taskId })
  }
  return { ...f, host, ancestry, check }
}

test.each(["tree-root", "nested-parent"])("hosted task wire retains ancestry from %s", async (parent) => {
  // given a real manager and RPC client over the socket fixture
  const f = await fixture()
  // when the manager launches a top-level or nested child
  const result = await f.manager.start(baseSpec({ ...f.ancestry, parent_session_id: parent }))
  if (result.kind !== "started") throw new Error(`task refused: ${result.kind}`)
  await launchSettled(f.manager, result.task_id)
  // then the serialized open contains durable session ancestry, not routing identity
  f.check(result.task_id, parent)
})

test("workflow node wire uses the manager task ID, not the workflow node ID", async () => {
  // given a real workflow scheduler and manager
  const f = await fixture()
  const store = createDagFileStore({ project_dir: f.project })
  const dag = createDagManager({ store })
  const { snapshot } = await dag.start({
    parentSessionId: "nested-parent", rootSessionId: "tree-root",
    definition: { key: "ancestry", name: "ancestry", nodes: [{ id: "node", category: "quick", prompt: "work" }] },
  })
  const scheduler = createDagScheduler({
    store, taskManager: f.manager, initialRecord: dag.record(snapshot.runId, "nested-parent"), ancestry: { depth: 2 },
  })
  const prompted = f.host.waitForCommand("prompt")
  // when the node reaches the real host wire
  const running = scheduler.run()
  try {
    await bounded(prompted)
    const record = f.manager.list({ scope: "all" })[0]?.record
    if (record === undefined) throw new Error("workflow task missing")
    await launchSettled(f.manager, record.task_id)
    // then ancestry names the allocated task
    f.check(record.task_id)
  } finally {
    await scheduler.suspend()
    await running
  }
})

test("team member wire preserves a nested lead's root", async () => {
  // given the team launcher over the real process manager
  const f = await fixture()
  // when the nested lead creates a member
  const result = await spawnTeamMembers({
    spec: normalizeSenpiTeamSpec({ members: [{ name: "member", kind: "category", category: "quick" }] }, "ancestry"),
    manager: f.manager, leadSessionId: "nested-parent", rootSessionId: "tree-root",
    teamRunId: "team-run", spawnDepth: 3, maxParallel: 1, deadlineAt: Number.MAX_SAFE_INTEGER, now: () => 0,
  })
  if (result.failure !== undefined) throw result.failure
  const member = result.spawned.get("member")
  if (member === undefined) throw new Error("team member missing")
  await launchSettled(f.manager, member.taskId)
  // then task ID, not team run or member name, is persisted on the wire
  f.check(member.taskId)
})

test.each(["fresh", "keep_alive"] as const)("workpool %s worker keeps ancestry across item turns", async (mode) => {
  // given the real workpool admission manager and host runner
  const f = await fixture()
  const caller = { sessionId: "nested-parent", rootSessionId: "tree-root", depth: 2, cwd: f.project }
  const pools = f.manager.workpools
  const pool = pools.create(caller, { name: "ancestry", agent: { category: "quick", prompt: "work" }, mode })
  try {
    // when two items run in fresh workers or the same resident worker
    const ids: string[] = []
    for (const key of ["first", "second"]) {
      const dispatched = pools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
      pools.push(caller, pool.pool_id, [{ key, input: key }])
      const event = await dispatched
      if (event.task_id === undefined || event.run_epoch === undefined) throw new Error("worker task missing")
      ids.push(event.task_id)
      f.check(event.task_id)
      expect(pools.yieldResults(event.task_id, event.run_epoch, {
        op: "yield", results: [{ key, data: key }],
      }).results[0]?.status).toBe("accepted")
      const session = f.host.sessions().find((entry) => entry.sessionPath.includes(event.task_id ?? "missing"))
      if (session === undefined) throw new Error("worker session missing")
      const idle = pools.waitForEvent(pool.pool_id, "worker_idle", AbortSignal.timeout(5000))
      f.host.completeTurn(session.routingId, "done")
      await idle
    }
    // then keep-alive reuse retains the original header and task identity
    expect(ids[0] === ids[1]).toBe(mode === "keep_alive")
    expect(f.host.commands.filter((command) => command.type === "open_session")).toHaveLength(mode === "keep_alive" ? 1 : 2)
  } finally {
    pools.dispose()
  }
})
