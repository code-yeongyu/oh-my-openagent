import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskRecordStore, type EnsureTaskDaemonInput } from "@oh-my-opencode/senpi-task"

import { hostSession, hostSessionRecordInput } from "../../../../senpi-task/src/lifecycle/__fixtures__/host-session-fakes"
import { seedRecord } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { createEngineHostRuntime } from "./host-execution-mode"
import { TaskRuntimeContext } from "./runtime-context"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("composeTaskEngine wires the session's host endpoint into the lifecycle", () => {
  test("#given a parked host child on a silent recorded shard #when session-start revival runs #then the engine's host ensures that socket", async () => {
    // given - a short root keeps the recorded socket under the unix bind limit
    const cwd = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omo-t8e-"))
    roots.push(cwd)
    const recordedSocket = join(cwd, "agent", "rpc", "shards", "p-00000000000000cc.sock")
    const ensures: EnsureTaskDaemonInput[] = []
    const omoConfig = loadOmoConfig({ cwd }).config
    const host = createEngineHostRuntime(omoConfig.task ?? OmoTaskSettingsSchema.parse({}), new TaskRuntimeContext(cwd), {}, {
      env: {},
      platform: "darwin",
      agentDir: join(cwd, "agent"),
      ensureDaemon: (request) => {
        ensures.push(request)
        return Promise.reject(new Error("the recorded shard stays silent"))
      },
      probeHost: () => Promise.resolve(undefined),
    })
    const engine = composeTaskEngine({ pi: new FakeExtensionAPI(), omoConfig, cwd, sharedParentTools: () => [], host })
    const store = createTaskRecordStore({ project_dir: cwd, task: { state_dir: engine.stateDir } })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0e000001", hostSession("st_0e000001", { socket: recordedSocket })),
      status: "running",
      residency_state: "rpc_detached",
    })

    try {
      // when
      await engine.lifecycle.reconcileOnSessionStart("parent-1")

      // then
      expect(ensures.map((request) => request.socket)).toEqual([recordedSocket])
      expect(store.load("st_0e000001")?.suspension_reason).toBe("daemon_unavailable")
    } finally {
      engine.lifecycle.dispose?.()
    }
  })
})
