import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { RunnerError } from "./in-process/runner-error"
import { isHostSessionHandle } from "./rpc-host"
import { HostUnavailableError } from "./rpc-host/daemon"
import { SessionHeldElsewhereError } from "./rpc-host/session-client"
import {
  CHILD_STATE_DIR,
  childSpec,
  fakeFallbackRunner,
  hostRunnerHarness,
  stubChannel,
} from "./rpc-host.test-support"
import type { FakeHostCommand } from "./rpc-host/__fixtures__/fake-host"
import type { RpcRunnerSpec } from "./types"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver, runnerWithout } = harness

afterEach(harness.release)

function ofType(commands: readonly FakeHostCommand[], type: string): readonly FakeHostCommand[] {
  return commands.filter((command) => command.type === type)
}

describe("RpcHostRunner start", () => {
  test("#given a daemon that lstats the session directory #when a fresh child starts under a state dir nobody created yet #then the runner creates the directory and the session opens", async () => {
    // given - the real host refuses open_session with ENOENT when the JSONL's directory is absent;
    // the client owns that directory, so a fresh child's runner has to create it first.
    const stateDir = mkdtempSync(join(tmpdir(), "dh-30-fresh-"))
    rmSync(stateDir, { recursive: true, force: true })
    const host = await fakeHost({ enforceSessionDir: true })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec({ state_dir: stateDir }))

    // then
    const [session] = host.sessions()
    expect(session?.sessionPath).toStartWith(join(stateDir, "sessions", "st_30"))
    expect(existsSync(join(stateDir, "sessions", "st_30"))).toBe(true)
    await handle.terminate()
    rmSync(stateDir, { recursive: true, force: true })
  })

  test("#given a reachable daemon #when a fresh child starts #then it opens a retained worker session and delivers the first prompt", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec())

    // then
    const [session] = host.sessions()
    expect(session).toMatchObject({
      kind: "worker",
      context: { role: "child", task_id: "st_30", state_dir: CHILD_STATE_DIR },
      retainOnDisconnect: true,
      autoTitle: false,
      attachments: 1,
    })
    expect(session?.sessionPath).toStartWith(join(CHILD_STATE_DIR, "sessions", "st_30"))
    expect(session?.sessionPath).toEndWith(".jsonl")
    expect(ofType(host.commands, "open_session")[0]?.payload).toMatchObject({
      cwd: "/tmp/dh-30-cwd",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "high",
      auto_title: false,
      retain_on_disconnect: true,
    })
    expect(ofType(host.commands, "prompt").map((command) => command.payload.message)).toEqual([
      "do the daemon child work",
    ])
    expect(handle.pid).toBeUndefined()
    expect(isHostSessionHandle(handle) ? handle.hostSession : undefined).toEqual({
      socket: host.socketPath,
      routingId: "routing-1",
      sessionPath: session?.sessionPath ?? "",
      instanceId: "fake-instance",
    })
  })

  test("#given a session the daemon still retains #when the child resumes #then it attaches without a second prompt or a switch", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host)
    const first = await runner.start(childSpec())
    const sessionPath = host.sessions()[0]?.sessionPath ?? ""
    await first.dispose()

    // when
    const resumed = await runner.start(childSpec({ resumeSessionPath: sessionPath }))

    // then - the SAME retained session, re-joined under a fresh routing handle
    expect(isHostSessionHandle(resumed) ? resumed.hostSession : undefined).toEqual({
      socket: host.socketPath,
      routingId: "routing-2",
      sessionPath,
      instanceId: "fake-instance",
    })
    expect(ofType(host.commands, "prompt")).toHaveLength(1)
    expect(ofType(host.commands, "switch_session")).toHaveLength(0)
    expect(host.sessions().map((session) => session.sessionPath)).toEqual([sessionPath])
    expect(resumed.rejoinedLiveSession).toBe(true)
  })

  test("#given a session path the daemon no longer holds #when the child resumes #then it reopens from the path, never re-prompts and stays steerable", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host)
    const sessionPath = join(CHILD_STATE_DIR, "sessions", "st_30", "2026-09-17T00:00:00.000Z_parked.jsonl")

    // when
    const handle = await runner.start(childSpec({ resumeSessionPath: sessionPath }))

    // then
    expect(isHostSessionHandle(handle) && handle.attached).toBe(true)
    expect(handle.rejoinedLiveSession).toBe(false)
    expect(ofType(host.commands, "prompt")).toHaveLength(0)
    expect(ofType(host.commands, "switch_session")).toHaveLength(0)
    expect(host.sessions().map((session) => session.sessionPath)).toEqual([sessionPath])
    await handle.followUp("keep going")
    expect(ofType(host.commands, "prompt").map((command) => command.payload)).toMatchObject([
      { message: "keep going", streamingBehavior: "followUp" },
    ])
  })
})

describe("RpcHostRunner fallback", () => {
  test("#given a daemon missing a session capability #when children start #then each one runs on the per-child runner and the reason is warned once", async () => {
    // given
    const host = await fakeHost()
    const fallback = fakeFallbackRunner()
    const warnings: string[] = []
    const runner = runnerOver(host, {
      ensureDaemon: () =>
        Promise.reject(
          new HostUnavailableError("capability", { fallbackAllowed: true, detail: "missing session_context" }),
        ),
      fallback,
      onWarning: (message) => warnings.push(message),
    })

    // when
    const first = await runner.start(childSpec())
    const second = await runner.start(childSpec({ task_id: "st_30b" }))

    // then
    expect([first, second]).toEqual([fallback.handle, fallback.handle])
    expect(fallback.starts.map((spec) => spec.task_id)).toEqual(["st_30", "st_30b"])
    expect(isHostSessionHandle(first)).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("host_unavailable:capability")
    expect(host.commands).toHaveLength(0)
  })

  test("#given an ensure that failed for a non-fallback reason #when a child starts #then it fails typed even though a fallback runner exists", async () => {
    // given
    const fallback = fakeFallbackRunner()
    const runner = runnerWithout({
      ensureDaemon: () =>
        Promise.reject(new HostUnavailableError("ensure_failed", { fallbackAllowed: false, detail: "socket dir unwritable" })),
      fallback,
    })

    // when
    const refusal = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(refusal) ? refusal.failure.kind : undefined).toBe("host_unavailable")
    expect(fallback.starts).toHaveLength(0)
  })

  test("#given no fallback runner #when the daemon refuses with a fallback-allowed reason #then the child fails typed", async () => {
    // given
    const runner = runnerWithout({
      ensureDaemon: () => Promise.reject(new HostUnavailableError("capability", { fallbackAllowed: true })),
    })

    // when
    const refusal = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(refusal) ? refusal.failure.kind : undefined).toBe("host_unavailable")
  })

  test("#given inherited parent extensions #when a child falls back #then admission and the per-child runner both see them", async () => {
    // given
    const admitted: RpcRunnerSpec[] = []
    const fallback = fakeFallbackRunner()
    const runner = runnerWithout({
      inheritedExtensions: ["/ext/provider.js"],
      modelAdmission: (spec) => {
        admitted.push(spec)
        return Promise.resolve()
      },
      ensureDaemon: () => Promise.reject(new HostUnavailableError("win32", { fallbackAllowed: true })),
      fallback,
      onWarning: () => undefined,
    })

    // when
    await runner.start(childSpec())

    // then
    expect(admitted.map((spec) => spec.extensions)).toEqual([["/ext/provider.js"]])
    expect(fallback.starts.map((spec) => spec.extensions)).toEqual([["/ext/provider.js"]])
  })
})

describe("RpcHostRunner start failures", () => {
  test("#given a host that rejects the first prompt #when a child starts #then the session is aborted and closed and the failure is typed", async () => {
    // given
    const channel = stubChannel(new Error("prompt rejected by the host"))
    const runner = runnerWithout({ createClient: () => channel, ensureDaemon: () => Promise.resolve(ensured()) })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("child-prompt-failed")
    expect(RunnerError.is(failure) ? failure.failure.rejected_while : undefined).toBe("alive")
    expect(RunnerError.is(failure) ? failure.failure.message : "").toContain("prompt rejected by the host")
    expect(channel.calls).toEqual(["open", "prompt", "abort", "close", "detach"])
  })

  test("#given a model the child profile cannot resolve #when a child starts #then the daemon is never asked to open a session", async () => {
    // given
    const host = await fakeHost()
    const ensures: string[] = []
    const runner = runnerOver(host, {
      modelAdmission: () =>
        Promise.reject(new RunnerError({ kind: "model_unavailable", message: "process model admission failed" })),
      ensureDaemon: () => {
        ensures.push("ensure")
        return Promise.resolve(ensured())
      },
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(host.commands).toHaveLength(0)
    expect(ensures).toHaveLength(0)
  })

  test("#given another instance holding the session path #when a child starts #then it fails typed and the next child still opens", async () => {
    // given
    const host = await fakeHost({
      openFailure: {
        code: "session_path_in_use",
        detail: "held by instance-b",
        data: { owner: "instance-b", retry_after_ms: 2_000 },
      },
    })
    const runner = runnerOver(host)

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("session_unavailable")
    expect(RunnerError.is(failure) ? failure.failure.cause : undefined).toBeInstanceOf(SessionHeldElsewhereError)
    expect(host.sessions()).toHaveLength(0)
    host.failOpen(undefined)
    await runner.start(childSpec({ task_id: "st_30c" }))
    expect(host.sessions()).toHaveLength(1)
  })
})

function ensured() {
  return {
    action: "reuse" as const,
    reason: "compatible",
    socket: "/tmp/dh-30-stub/rpc.sock",
    pid: 4242,
    reused: true,
    upgradeable: true,
  }
}
