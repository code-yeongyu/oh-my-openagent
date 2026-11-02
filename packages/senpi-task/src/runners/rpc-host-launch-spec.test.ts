import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskDaemonHostPort } from "../lazy/senpi-barrel"
import { FakeRunner, cleanupProjects, makeManager } from "../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../manager/child-handle"
import { normalizeSenpiTeamSpec, spawnTeamMembers } from "../team"
import { RunnerError } from "./in-process/runner-error"
import { ensureTaskDaemon, type EnsureTaskDaemonInput } from "./rpc-host/daemon"
import { MEMBER_EXTENSION_BUNDLE_NAME } from "../team/member-extension/identity"
import type { FakeHost } from "./rpc-host/__fixtures__/fake-host"
import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"

const { fakeHost, runnerOver, release } = hostRunnerHarness()
const scratch: string[] = []
const posixOnly = test.skipIf(process.platform === "win32")

afterEach(async () => {
  cleanupProjects()
  await release()
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pluginSpec(mode: number): string {
  const pluginRoot = mkdtempSync(join(tmpdir(), "rpc-host-launch-spec-"))
  scratch.push(pluginRoot)
  mkdirSync(join(pluginRoot, "extensions"), { recursive: true })
  writeFileSync(join(pluginRoot, "extensions", MEMBER_EXTENSION_BUNDLE_NAME), "export {}\n")
  const path = join(pluginRoot, "daemon-launch-spec.json")
  writeFileSync(path, `${JSON.stringify({
    spec_version: 1,
    core: { session_runtime: "in-process", multi_session: true, extensions: [".", `./extensions/${MEMBER_EXTENSION_BUNDLE_NAME}`] },
    tunables: { idleExitMs: 900_000, coldStart: "transient" },
    env: { OMO_NATIVE: "1" },
  }, null, 2)}\n`)
  chmodSync(path, mode)
  return path
}

function hostPort(host: FakeHost, ensures: string[]): TaskDaemonHostPort {
  return {
    engineBuildIdentity: () => ({ text: "2026.9.29", ordinal: [2026, 9, 29, 0, 0], scheme: "epoch" }),
    probeHost: async () => undefined,
    decideHostAction: () => ({ action: "reuse", reason: "compatible", upgradeable: false }),
    ensureHost: async (input) => {
      ensures.push(input.socket)
      return { pid: 4242, socket: host.socketPath, reused: true }
    },
  }
}

function realEnsure(host: FakeHost, specPath: string, ensures: string[]) {
  return (input: EnsureTaskDaemonInput) => ensureTaskDaemon({
    ...input,
    ports: { host: hostPort(host, ensures), launchSpecPath: specPath, platform: "linux", bunRuntimeAvailable: true },
  })
}

describe("RpcHostRunner launch spec rejection (#9208)", () => {
  posixOnly("#given a group-writable launch spec #when a process child starts #then it fails typed launch_spec_insecure with the path and never falls back", async () => {
    const host = await fakeHost()
    const specPath = pluginSpec(0o664)
    const ensures: string[] = []
    const fallback = fakeFallbackRunner()
    const runner = runnerOver(host, { fallback, ensureDaemon: realEnsure(host, specPath, ensures) })

    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    if (!RunnerError.is(failure)) throw new Error(`expected a RunnerError, got ${String(failure)}`)
    expect(failure.failure.kind).toBe("host_unavailable")
    expect(failure.failure.reason).toBe("launch_spec_insecure")
    expect(failure.failure.launch_spec_path).toBe(specPath)
    expect(ensures).toEqual([])
    expect(fallback.starts).toEqual([])
  })

  posixOnly("#given the same spec made 0644 #when a process child starts #then it opens on the host", async () => {
    const host = await fakeHost()
    const specPath = pluginSpec(0o644)
    const ensures: string[] = []
    const runner = runnerOver(host, { ensureDaemon: realEnsure(host, specPath, ensures) })

    const handle = await runner.start(childSpec())

    expect(ensures).toHaveLength(1)
    expect(host.sessions()).toHaveLength(1)
    await handle.terminate()
  })

  posixOnly("#given a group-writable launch spec #when a task and a team member start #then the record, the task error and the team error name the reason, the path and the fix", async () => {
    const host = await fakeHost()
    const specPath = pluginSpec(0o664)
    const runner = runnerOver(host, { ensureDaemon: realEnsure(host, specPath, []) })
    // The manager's process lane receives a ManagedStartSpec; production adapts it to an RPC child
    // spec before the real host runner, so this adapter does the same and keeps its real failure.
    const processLane = {
      start: async (): Promise<ManagedChildHandle> => {
        await runner.start(childSpec())
        throw new Error("a refused launch spec must not start a child")
      },
    }
    const { manager, store } = makeManager({ inProcess: new FakeRunner(), process: processLane })
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "echo", kind: "category", category: "quick", prompt: "Reply with exactly TEAM_OK." }] },
      "smoke",
    )

    const result = await spawnTeamMembers({
      spec,
      teamRunId: "team-run-9208",
      manager,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      maxParallel: 1,
      deadlineAt: Number.MAX_SAFE_INTEGER,
      now: () => 0,
    })

    const message = result.failure?.message ?? ""
    expect(message).toStartWith("member 'echo' failed to start: ")
    expect(message).toContain(`launch_spec_insecure: ${specPath}`)
    expect(message).toContain(`chmod 644 ${specPath}`)
    const [record] = store.list().records
    expect(record?.failure_kind).toBe("host_unavailable")
    expect(record?.failure_reason).toBe("launch_spec_insecure")
    expect(record?.error_message).toContain(`launch_spec_insecure: ${specPath}`)
    expect(record?.error_message).toContain(`chmod 644 ${specPath}`)
  })
})
