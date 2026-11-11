import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "../../../state"
import { buildRespawnManagedSpec } from "../../../manager/manager-helpers"
import { classifyResumeFailure } from "../../../manager/respawn-failure"
import { createInProcessManagedRunner, type InProcessRunnerLike } from "../../../manager/runner"
import { RunnerError } from "../../in-process/runner-error"
import { RpcHostRunner } from "../../rpc-host"
import { fakeFallbackRunner } from "../../rpc-host/__fixtures__/host-world-ports"
import type { RpcRunnerSpec } from "../../types"

const neverStarts: InProcessRunnerLike = {
  start: () => Promise.reject(new Error("an in-process child must never start for a sandboxed spec")),
  resume: () => Promise.reject(new Error("an in-process child must never resume for a sandboxed spec")),
}

function legacyReviewerRecord(agentType: string) {
  const record = createTaskRecord(
    {
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 1,
      agent_type: agentType,
      // Written before senpi#6287: the review trio was pinned in-process and carried no sandbox field.
      execution_mode: "in-process",
      model: "anthropic/claude",
      notify_on_terminal: false,
    },
    Date.parse("2026-11-10T00:00:00.000Z"),
  )
  return { ...record, spawn_spec: { version: 1 as const, cwd: "/tmp/project", prompt: "review the diff" } }
}

describe("deny-live policy at the launch boundary", () => {
  test("#given a reviewer record from before the sandbox existed, under its legacy name #when it is rebuilt for respawn #then the spec still demands the sandbox", () => {
    const rebuilt = buildRespawnManagedSpec(legacyReviewerRecord("omo-senpi-gate-reviewer"), "/tmp/store")
    expect(rebuilt.ok && rebuilt.spec.sandbox).toBe("deny-live")
  })

  test("#given a non-review agent #when its spec is rebuilt #then no sandbox is demanded", () => {
    const rebuilt = buildRespawnManagedSpec(legacyReviewerRecord("explore"), "/tmp/store")
    expect(rebuilt.ok && rebuilt.spec.sandbox).toBeUndefined()
  })

  test("#given a sandboxed spec #when the in-process runner is asked to start or resume it #then it refuses and the refusal is terminal", async () => {
    const rebuilt = buildRespawnManagedSpec(legacyReviewerRecord("omo-native-code-reviewer"), "/tmp/store")
    if (!rebuilt.ok) throw new Error(rebuilt.reason)
    const runner = createInProcessManagedRunner(neverStarts)

    const started = runner.start(rebuilt.spec)
    await expect(started).rejects.toBeInstanceOf(RunnerError)
    const resumed = await runner.resume?.(rebuilt.spec, "/tmp/session.jsonl").then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(RunnerError.is(resumed) && resumed.failure.kind).toBe("sandbox_required")
    expect(classifyResumeFailure(resumed)).toMatchObject({
      ok: false,
      disposition: "unrecoverable",
      code: "sandbox_required",
    })
  })
})

describe("deny-live policy on the task-daemon runner", () => {
  function hostRunner() {
    const fallback = fakeFallbackRunner()
    const daemonAsks: string[] = []
    const runner = new RpcHostRunner({
      policy: "upgrade",
      agentDir: "/tmp/agent",
      storeDir: "/tmp/store",
      shardResolver: () => ({
        socket: "/tmp/host.sock",
        shard: { kind: "p", key: "0000000000000000", ownerSessionId: "parent", inherited: false },
        root: "primary",
      }),
      ownHostSocket: () => undefined,
      insideHost: () => false,
      onNotice: () => undefined,
      shardEvents: {},
      env: {},
      ensureDaemon: () => {
        daemonAsks.push("ensure")
        return Promise.reject(new Error("the daemon must never be asked to host a sandboxed child"))
      },
      modelAdmission: () => Promise.resolve(),
      fallback,
    })
    return { runner, fallback, daemonAsks }
  }
  const spec: RpcRunnerSpec = {
    task_id: "st_r",
    cwd: "/tmp/project",
    state_dir: "/tmp/store/children/st_r",
    prompt: "review",
    sandbox: "deny-live",
  }

  test("#given a fresh sandboxed spec #when the daemon runner starts it #then it runs on the per-child runner and the daemon is never asked", async () => {
    const { runner, fallback, daemonAsks } = hostRunner()
    await runner.start(spec)
    expect(fallback.starts).toHaveLength(1)
    expect(daemonAsks).toEqual([])
  })

  test("#given a review child recorded on a daemon session #when it is resumed #then the resume is refused so no second writer opens its transcript", async () => {
    const { runner, fallback, daemonAsks } = hostRunner()
    const resumed = await runner
      .start({ ...spec, hostSocket: "/tmp/host.sock", resumeSessionPath: "/tmp/s.jsonl" })
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(RunnerError.is(resumed) && resumed.failure.kind).toBe("sandbox_required")
    expect(fallback.starts).toEqual([])
    expect(daemonAsks).toEqual([])
  })
})
