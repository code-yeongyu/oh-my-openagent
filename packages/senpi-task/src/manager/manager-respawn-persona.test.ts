import { afterEach, describe, expect, test } from "bun:test"

import { PersonaTooLargeError } from "../runners/rpc/persona-args"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, type TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { categoryPlanner, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

function harness(spawnSpec: TaskRecord["spawn_spec"], start: (spec: RpcRunnerSpec) => Promise<RpcChildHandle>) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const record: TaskRecord = {
    ...createTaskRecord(
      {
        parent_session_id: "parent-persona",
        root_session_id: "parent-persona",
        depth: 1,
        execution_mode: "process",
        model: "fake-model",
        notify_on_terminal: false,
      },
      Date.parse("2026-11-10T00:00:00.000Z"),
    ),
    spawn_spec: spawnSpec,
    tool_deny: ["write", "edit"],
  }
  store.save(record)
  const handle = makeHandle(record.task_id).handle
  const starts: RpcRunnerSpec[] = []
  const manager = createTaskManager({
    store,
    runners: { "in-process": { start: async () => handle }, process: { start: async () => handle } },
    rpcRespawnRunner: {
      start: (spec) => {
        starts.push(spec)
        return start(spec)
      },
    },
    planner: categoryPlanner(),
    config: settings(),
    cwd: project,
    now: () => Date.parse("2026-11-10T01:00:00.000Z"),
  })
  return { manager, record, starts, project }
}

const refuse = (error: Error) => () => Promise.reject(error)

describe("process respawn keeps the persona or fails closed", () => {
  test("#given a resumable pre-v1 process record with a denylist #when it resumes #then the child is started with the record's denylist", async () => {
    // given
    const fixture = harness(
      { cwd: "/tmp" } as unknown as TaskRecord["spawn_spec"],
      refuse(new Error("stop after the launch spec is captured")),
    )

    // when
    await fixture.manager.respawn(fixture.record, "/tmp/persona-resume.jsonl")

    // then
    expect(fixture.starts[0]?.toolDenylist).toEqual(["write", "edit"])
  })

  test.each([
    ["resume", "/tmp/persona-resume.jsonl"],
    ["fresh respawn", undefined],
  ] as const)(
    "#given a persona over the argv budget #when the %s launch refuses it #then the failure is unrecoverable, not retried",
    async (_kind, sessionPath) => {
      // given
      const fixture = harness(
        { version: 1, cwd: "/tmp", prompt: "review" },
        refuse(new PersonaTooLargeError(200_000, 100_000, "UTF-8 bytes")),
      )

      // when
      const result = await fixture.manager.respawn(fixture.record, sessionPath)

      // then
      expect(result).toMatchObject({ ok: false, disposition: "unrecoverable", code: "respawn_failed" })
      expect(fixture.starts[0]?.toolDenylist).toEqual(["write", "edit"])
    },
  )
})
