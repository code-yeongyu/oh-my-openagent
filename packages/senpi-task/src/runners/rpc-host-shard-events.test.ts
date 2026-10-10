import { afterEach, describe, expect, test } from "bun:test"

import type { ReattachOutcomeInfo, TransportLostInfo } from "./rpc-host/handle-reattach"
import { isHostSessionHandle } from "./rpc-host"
import { childSpec, ensuredDaemon, hostRunnerHarness } from "./rpc-host.test-support"

// Todo 10: the runner tells the parent's crash notice when each child starts recovering from a lost
// host and how that recovery ended, without changing what recovery does.

const { fakeHost, runnerOver, release } = hostRunnerHarness()

afterEach(async () => {
  await release()
})

const NO_WAIT = { reattachDelaysMs: [0, 0, 0], sleep: () => Promise.resolve() } as const

function recorder() {
  const lost: TransportLostInfo[] = []
  const outcome = Promise.withResolvers<ReattachOutcomeInfo>()
  return {
    lost,
    outcome: outcome.promise,
    events: {
      onTransportLost: (info: TransportLostInfo) => lost.push(info),
      onReattachOutcome: (info: ReattachOutcomeInfo) => outcome.resolve(info),
    },
  }
}

describe("RpcHostRunner shard events", () => {
  test("#given a child mid-turn #when its host dies and comes back #then it reports the lost generation and a continued outcome on the new one", async () => {
    // given
    const host = await fakeHost()
    const seen = recorder()
    const runner = runnerOver(host, { ...NO_WAIT, shardEvents: seen.events })
    const handle = await runner.start(childSpec())
    if (!isHostSessionHandle(handle)) throw new Error("the child did not open on the host")
    const lostGeneration = handle.hostSession.instanceId

    // when
    await host.restart()
    const reported = await seen.outcome

    // then
    expect(seen.lost).toHaveLength(1)
    expect(seen.lost[0]).toMatchObject({
      taskId: handle.task_id,
      socket: host.socketPath,
      instanceId: lostGeneration,
      turnWasInFlight: true,
      boundTaskIds: [handle.task_id],
    })
    expect(reported.outcome).toBe("continued")
    expect(reported.socket).toBe(host.socketPath)
    expect(reported.newInstanceId).toBe(handle.hostSession.instanceId)
    await handle.terminate()
  })

  test("#given a child mid-turn #when its host never comes back #then it reports lost", async () => {
    // given
    const host = await fakeHost()
    const seen = recorder()
    const runner = runnerOver(host, { ...NO_WAIT, shardEvents: seen.events })
    const handle = await runner.start(childSpec())

    // when
    host.crash()
    const reported = await seen.outcome

    // then
    expect(seen.lost.map((info) => info.turnWasInFlight)).toEqual([true])
    expect(reported.outcome).toBe("lost")
    expect(reported.newInstanceId).toBeUndefined()
    expect((await handle.waitForExit()).kind).toBe("crashed")
  })

  test("#given two children on one host generation #when it dies #then the FIRST loss already names both and the supervisor the runner ensured", async () => {
    // given
    const host = await fakeHost()
    const lost: TransportLostInfo[] = []
    const outcomes: ReattachOutcomeInfo[] = []
    const bothSettled = Promise.withResolvers<void>()
    const runner = runnerOver(host, {
      ...NO_WAIT,
      ensureDaemon: () => Promise.resolve({ ...ensuredDaemon(host.socketPath), instanceId: host.instanceId }),
      shardEvents: {
        onTransportLost: (info) => lost.push(info),
        onReattachOutcome: (info) => {
          outcomes.push(info)
          if (outcomes.length === 2) bothSettled.resolve()
        },
      },
    })
    const first = await runner.start(childSpec({ task_id: "st_a" }))
    const second = await runner.start(childSpec({ task_id: "st_b" }))

    // when
    await host.restart()
    await bothSettled.promise

    // then
    expect([...(lost[0]?.boundTaskIds ?? [])].sort()).toEqual(["st_a", "st_b"])
    expect(lost[0]?.supervisorPid).toBe(4242)
    expect(outcomes.map((info) => info.outcome)).toEqual(["continued", "continued"])
    await first.terminate()
    await second.terminate()
  })

  test("#given a child whose host died #when it is cancelled before its reattach finishes #then it reports cancelled, not lost", async () => {
    // given - the reattach backoff waits until the child was terminated
    const host = await fakeHost()
    const seen = recorder()
    const backoff = Promise.withResolvers<void>()
    const backingOff = Promise.withResolvers<void>()
    const runner = runnerOver(host, {
      reattachDelaysMs: [0],
      sleep: () => {
        backingOff.resolve()
        return backoff.promise
      },
      shardEvents: seen.events,
    })
    const handle = await runner.start(childSpec())
    host.crash()
    await backingOff.promise

    // when
    await handle.terminate()
    backoff.resolve()

    // then
    expect((await seen.outcome).outcome).toBe("cancelled")
  })

  test("#given an observer that throws #when the host dies and comes back #then the child still reattaches and is re-prompted", async () => {
    // given
    const host = await fakeHost()
    const runner = runnerOver(host, {
      ...NO_WAIT,
      shardEvents: {
        onTransportLost: () => {
          throw new Error("observer bug")
        },
        onReattachOutcome: () => {
          throw new Error("observer bug")
        },
      },
    })
    const handle = await runner.start(childSpec())

    // when
    await host.restart()
    await host.waitForCommand("prompt")

    // then
    expect(handle.exitOutcome()).toBeUndefined()
    await handle.terminate()
  })
})
