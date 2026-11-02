import { afterAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { RunnerError } from "./in-process/runner-error"
import { RpcHostRunner, type HostSessionChannel } from "./rpc-host"
import { childSpec, tempAgentDir, testRouting } from "./rpc-host.test-support"

const agentDirs: string[] = []

afterAll(() => {
  for (const dir of agentDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function routing(socket: string) {
  const agentDir = tempAgentDir()
  agentDirs.push(agentDir)
  return testRouting(socket, agentDir)
}

describe("RpcHostRunner host failure classification", () => {
  test("#given the daemon transport is unreachable #when a child starts #then the runner raises host_unavailable with a closed reason", async () => {
    // given
    const transportError = Object.assign(
      new Error("connect ECONNREFUSED /private/socket"),
      { code: "ECONNREFUSED" },
    )
    const runner = new RpcHostRunner({
      policy: "upgrade",
      ...routing("/tmp/host.sock"),
      modelAdmission: async () => {},
      ensureDaemon: () => Promise.reject(transportError),
    })

    // when
    const failure = await runner.start(childSpec()).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "host_unavailable",
      reason: "host_unreachable",
    })
  })

  test("#given a local session-directory error #when a child starts #then it is not misreported as an unreachable host", async () => {
    // given a state dir that is a regular file: creating the session directory under it fails on
    // every OS (on Windows "/dev/null" is an ordinary creatable path, so it did not fail there)
    const scratch = mkdtempSync(join(tmpdir(), "omo-start-failure-"))
    const stateFile = join(scratch, "state-is-a-file")
    writeFileSync(stateFile, "")
    const opened: string[] = []
    const runner = new RpcHostRunner({
      policy: "upgrade",
      ...routing("/tmp/host.sock"),
      modelAdmission: async () => {},
      ensureDaemon: () => Promise.resolve({
        action: "reuse",
        reason: "compatible",
        socket: "/tmp/host.sock",
        pid: 1,
        reused: true,
        upgradeable: true,
      }),
      // Every host call is recorded: the host must not be asked to open a session whose local
      // directory could not be created.
      createClient: () => new Proxy({} as HostSessionChannel, {
        get: (_target, method) => method === "then" ? undefined : () => {
          opened.push(String(method))
          return Promise.reject(new Error("the host must not be contacted"))
        },
      }),
    })

    // when
    const failure = await runner.start({
      ...childSpec(),
      state_dir: stateFile,
    }).catch((error: unknown) => error)
    rmSync(scratch, { recursive: true, force: true })

    // then
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "host_unavailable",
    })
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBeUndefined()
    expect(opened).toEqual([])
  })

  test("#given a cached daemon endpoint that no longer answers #when the real client probes it #then the host is unreachable, not protocol-incompatible", async () => {
    // given
    const socket = join(tmpdir(), `omo-8960-absent-${randomUUID()}.sock`)
    const runner = new RpcHostRunner({
      policy: "upgrade",
      ...routing(socket),
      modelAdmission: async () => {},
      ensureDaemon: () => Promise.resolve({
        action: "reuse",
        reason: "compatible",
        socket,
        pid: 1,
        reused: true,
        upgradeable: true,
      }),
    })

    // when
    const failure = await runner.start({
      ...childSpec(),
      resumeSessionPath: join(tmpdir(), `omo-8960-existing-${randomUUID()}.jsonl`),
    }).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "host_unavailable",
      reason: "host_unreachable",
    })
  })
})
