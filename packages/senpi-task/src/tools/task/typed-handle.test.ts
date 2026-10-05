import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"

import { cleanupProjects, makeManager, settings } from "../../manager/__fixtures__/manager-fakes"
import type { TaskRecord } from "../../state"
import { buildTaskExecute } from "./execute"
import { recordDetails } from "./result-details"
import { CTX, makeDeps } from "./__fixtures__/task-tool-fakes"
import type { TaskToolDetails } from "./types"
import { realSessionHandle } from "./__fixtures__/typed-handle-session"

function matched(details: object, record: TaskRecord | null | undefined): void {
  if (!record) throw new Error("expected the authoritative task record")
  expect(record.task_id).toMatch(/^st_[0-9a-f]+$/)
  expect(Number.isInteger(record.notification.run_epoch)).toBe(true)
  expect(record.notification.run_epoch).toBeGreaterThanOrEqual(0)
  expect(details).toMatchObject({ task_id: record.task_id, run_epoch: record.notification.run_epoch })
}

function evidence(name: string, value: unknown): void {
  const directory = process.env.TYPED_HANDLE_EVIDENCE_DIR
  if (directory) writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2))
}

afterEach(cleanupProjects)

describe("typed task handles", () => {
  test("#given a real restored session #when the task tool returns #then its handle matches the actual record", async () => {
    // given / when
    const receipt = await realSessionHandle()
    // then
    matched(receipt.response.details, receipt.record)
    expect(receipt.sessionText).toBe("TYPED_HANDLE_SESSION_SENTINEL")
    expect(receipt.transcriptMessages).toHaveLength(1)
    for (const transcript of receipt.transcriptMessages) expect(transcript.after).toBe(transcript.before)
    evidence("real-session", receipt)
  })

  test("#given foreground output containing unrelated ids #when completed #then the body and record identity are preserved", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const body = "FOREGROUND_SENTINEL st_11111111 st_22222222"
    // when
    const response = await buildTaskExecute(makeDeps(manager))("foreground", { prompt: "Inspect", category: "quick" },
      undefined, (update) => {
        const child = inProcess.handles.get(update.details.task_id)
        if (!child) throw new Error("missing foreground child")
        child.settle({ status: "completed", finalResponse: body })
      }, CTX)
    // then
    matched(response.details, store.load(response.details.task_id))
    expect(store.load(response.details.task_id)?.final_response).toBe(body)
    expect(response.content[0]?.type === "text" && response.content[0].text.startsWith(body)).toBe(true)
    expect(response.details.run_in_background).toBe(false)
  })

  test("#given immediate and queued starts #when returning handles #then details match record epoch", async () => {
    // given
    const { manager, store } = makeManager({ config: settings({ default_concurrency: 1 }) })
    const execute = buildTaskExecute(makeDeps(manager))
    const receipts: unknown[] = []
    // when
    for (const status of ["running", "pending"]) {
      const response = await execute("start", { prompt: "Inspect the fixture", category: "quick", run_in_background: true }, undefined, undefined, CTX)
      // then
      const record = store.load(response.details.task_id)
      matched(response.details, record)
      expect(response.details.status).toBe(status)
      expect(response.details.run_in_background).toBe(true)
      receipts.push({ details: response.details, record })
    }
    evidence("happy", receipts)
  })

  test("#given a batch with a refusal #when returning queued handles #then every successful item matches its record", async () => {
    // given
    const { manager, store } = makeManager({
      config: settings({ default_concurrency: 1 }),
      planner: (spec) => spec.category === "refuse"
        ? { kind: "error", error: { code: "unknown_target", message: "st_11111111 and st_22222222 succeeded elsewhere" } }
        : { kind: "resolved", plan: { model: "fixture/model" } },
    })
    // when
    const response = await buildTaskExecute(makeDeps(manager))("batch", {
      run_in_background: true,
      tasks: [
        { prompt: "Denied", category: "refuse" },
        { prompt: "First", category: "quick" },
        { prompt: "Second", category: "quick" },
      ],
    }, undefined, undefined, CTX)
    // then
    matched(response.details, store.load(response.details.task_id))
    expect(response.details.items).toHaveLength(3)
    for (const item of response.details.items ?? []) {
      if (item.status === "error") {
        expect(item.task_id).toBe("")
        expect(item).not.toHaveProperty("run_epoch")
      } else matched(item, store.load(item.task_id))
    }
  })

  test("#given foreground progress #when a deadline promotes the task #then progress and handle retain the same identity", async () => {
    // given
    const { manager, store } = makeManager()
    const scheduled = Promise.withResolvers<() => void>()
    const updates: TaskToolDetails[] = []
    const execute = buildTaskExecute(makeDeps(manager), {
      scheduleDeadline: (callback) => { scheduled.resolve(callback); return () => {} },
    })
    // when
    const pending = execute("promote", { prompt: "Inspect", category: "quick" }, undefined,
      (update) => updates.push(update.details), { ...CTX, getPromptCacheSafeWaitSeconds: () => 1 })
    const promote = await scheduled.promise
    promote()
    const response = await pending
    // then
    expect(updates.length).toBeGreaterThan(0)
    for (const details of [...updates, response.details]) matched(details, store.load(response.details.task_id))
    expect(response.details.run_in_background).toBe(true)
  }, 20000)

  test("#given a foreground batch #when deadlines promote both children #then aggregate and progress identities match", async () => {
    // given
    const { manager, store } = makeManager()
    const scheduled = Promise.withResolvers<void>()
    const deadlines: Array<() => void> = []
    const updates: TaskToolDetails[] = []
    const execute = buildTaskExecute(makeDeps(manager), {
      scheduleDeadline: (callback) => {
        deadlines.push(callback)
        if (deadlines.length === 2) scheduled.resolve()
        return () => {}
      },
    })
    // when
    const pending = execute("batch-promote", { tasks: [{ prompt: "First", category: "quick" }, { prompt: "Second", category: "quick" }] },
      undefined, (update) => updates.push(update.details), { ...CTX, getPromptCacheSafeWaitSeconds: () => 1 })
    await scheduled.promise
    for (const promote of deadlines) promote()
    const response = await pending
    // then
    for (const details of [...updates, response.details]) {
      matched(details, store.load(details.task_id))
      for (const item of details.items ?? []) matched(item, store.load(item.task_id))
    }
  }, 20000)

  test("#given repeated interrupts and resumes #when constructing revived handles #then epochs advance without changing stale snapshots", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const response = await buildTaskExecute(makeDeps(manager))("revive", { prompt: "Inspect", category: "quick", run_in_background: true }, undefined, undefined, CTX)
    const id = response.details.task_id
    const initial = store.load(id)
    if (!initial) throw new Error("missing initial record")
    const child = inProcess.handles.get(id)
    if (!child) throw new Error("missing child")
    // when
    for (let turn = 1; turn <= 2; turn++) {
      await manager.interruptTask(id)
      await manager.interruptTask(id)
      const continued = await manager.continueTask(id, "Continue the fixture")
      // then
      expect(continued.kind).toBe("continued")
      const revived = store.load(id)
      if (!revived) throw new Error("missing revived record")
      expect(revived.notification.run_epoch).toBe(initial.notification.run_epoch + turn)
      matched(recordDetails(revived, "spawn"), revived)
      matched(response.details, initial)
    }
    await manager.cancelTask(id)
    expect((await manager.continueTask(id, "Cannot resume cancelled task")).kind).toBe("not_continuable")
  })

  test("#given misleading-success prose #when spawning or refusing #then prose ids and refusals cannot fabricate handles", async () => {
    // given
    const prose = "st_11111111 succeeded, st_22222222 succeeded; neither identifies this task"
    const { manager, store } = makeManager()
    const execute = buildTaskExecute(makeDeps(manager))
    const denied = makeManager({ admit: async () => ({ kind: "rejected", message: prose }) })
    const failed = makeManager()
    failed.inProcess.throwOnStart = true
    // when
    const success = await execute("prose", { prompt: prose, name: prose, category: "quick", run_in_background: true }, undefined, undefined, CTX)
    const refusal = await buildTaskExecute(makeDeps(denied.manager))("refuse", { prompt: prose, category: "quick", run_in_background: true }, undefined, undefined, CTX)
    const failure = await buildTaskExecute(makeDeps(failed.manager))("fail", { prompt: prose, category: "quick", run_in_background: true }, undefined, undefined, CTX)
    const aborted = await execute("abort", { prompt: prose, category: "quick", run_in_background: true }, AbortSignal.abort(), undefined, CTX)
    // then
    matched(success.details, store.load(success.details.task_id))
    expect(success.details.task_id).not.toBe("st_11111111")
    expect(success.details.task_id).not.toBe("st_22222222")
    expect(refusal.details.task_id).toBe("")
    expect(aborted.details.task_id).toBe("")
    for (const result of [refusal, failure, aborted]) expect(result.details).not.toHaveProperty("run_epoch")
    evidence("failure", { success: success.details, record: store.load(success.details.task_id), refusal: refusal.details, failure: failure.details, aborted: aborted.details })
  })
})
