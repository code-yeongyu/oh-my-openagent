import { afterEach, describe, expect, test } from "bun:test"

import { adaptRpcHandle } from "../../manager/child-handle"
import { HOST_TURN_RESUMED_EVENT } from "../../manager/host-turn-resumed"
import type { FakeHost } from "./__fixtures__/fake-host"
import { createHostSessionHandle } from "./handle"
import type { HostSessionChildHandle, HostSessionIdentity } from "./handle-port"
import { event, fakeSessionPort, FAKE_SESSION } from "./handle.test-support"
import { HOST_SESSION_REATTACH_TAG, type HostSessionReattach } from "./reattach"
import { childOpenInput } from "./session-client.test-support"
import { sessionClientHarness } from "./session-client.test-support"
import { TRANSPORT_LOST_REASON } from "./transport-recovery"

// omo#8563: a lost connection ended every host-session child as crashed(transport_gone) while its
// session kept running on the daemon (or sat intact in its JSONL after the daemon died). The
// handle now hands the loss to a reattach port: the runner re-ensures the daemon and reopens the
// same session path, the handle adopts the new connection, and only an in-flight turn that the
// host no longer runs is re-prompted.

const { fakeHost, hostClient, release } = sessionClientHarness()

afterEach(async () => {
  await release()
})

function reopenOn(host: FakeHost): HostSessionReattach {
  return async (session: HostSessionIdentity) => {
    const client = hostClient(host)
    const opened = await client.open(childOpenInput(session.sessionPath))
    return {
      client,
      session: { routingId: opened.sessionId, sessionPath: session.sessionPath, instanceId: opened.instanceId },
      attached: opened.attached,
    }
  }
}

async function openWithReattach(host: FakeHost, sessionPath: string, reattach: HostSessionReattach): Promise<HostSessionChildHandle> {
  const client = hostClient(host)
  const opened = await client.open(childOpenInput(sessionPath))
  return createHostSessionHandle({
    client,
    session: { routingId: opened.sessionId, sessionPath, instanceId: opened.instanceId },
    taskId: "st_31_reattach",
    heartbeatIntervalMs: 60_000,
    now: () => 13,
    closeGraceMs: 100,
    openDisposition: opened.attached ? "attached" : "reopened",
    reattach,
  })
}

function promptsOn(host: FakeHost): string[] {
  return host.commands.filter((command) => command.type === "prompt").map((command) => String(command.payload.message))
}

describe("host-session handle reattach", () => {
  test("#given progress subscribers #when the transport is replaced twice #then subscriptions survive until released and stale ports stay silent", async () => {
    // given
    const ports = [fakeSessionPort(), fakeSessionPort(), fakeSessionPort()]
    let generation = 0
    const handle = createHostSessionHandle({
      client: ports[0],
      session: FAKE_SESSION,
      taskId: "st_progress_reattach",
      heartbeatIntervalMs: 60_000,
      now: () => 13,
      closeGraceMs: 100,
      openDisposition: "attached",
      reattach: async () => ({ client: ports[++generation], session: FAKE_SESSION, attached: true }),
    })
    const observed: string[] = []
    const released: string[] = []
    const unsubscribe = handle.subscribe((next) => observed.push(next.type))
    const releaseEarly = handle.subscribe((next) => released.push(next.type))
    const progress = event({ type: "turn_start" })
    ports[0].emitEvent(progress)
    releaseEarly()

    try {
      // when: both replacements preserve the same running session
      for (let index = 1; index < ports.length; index++) {
        ports[index - 1].loseTransport()
        await ports[index].stateAsked()
        await ports[index].answerState({ sessionId: "child", isStreaming: true })
        ports[index - 1].emitEvent(progress)
        ports[index].emitEvent(progress)
      }

      // then: no duplicate or discarded-port events; unsubscribe remains valid after recovery
      expect(observed).toEqual(["turn_start", "turn_start", "turn_start"])
      expect(released).toEqual(["turn_start"])
      unsubscribe()
      unsubscribe()
      ports[2].emitEvent(progress)
      expect(observed).toHaveLength(3)
      handle.subscribe((next) => observed.push(next.type))
    } finally {
      await handle.dispose()
    }
    ports[2].emitEvent(progress)
    expect(observed).toHaveLength(3)
  })

  test("#given a turn in flight #when the connection is cut while the host keeps the session #then the handle re-joins it and the turn completes without a second prompt", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-a.jsonl", reopenOn(host))
    const observed: string[] = []
    handle.subscribe((event) => observed.push(event.type))
    await handle.startInitialPrompt("do the work")
    // Recovery reads the re-joined session's state right after adopting the new port, so this
    // command is the first thing the host sees from the reattached handle.
    const rejoined = host.waitForCommand("get_state")

    // when
    host.cutConnections()
    await rejoined

    // then: the session is still live and streaming on the host, so the handle only re-joins it
    const live = host.sessions().find((session) => session.sessionPath === "/tmp/sessions/reattach-a.jsonl")
    if (live === undefined) throw new Error("the host lost the session")
    host.completeTurn(live.routingId, "finished after the cut")
    expect((await handle.waitForOutcome()).status).toBe("completed")
    expect(handle.lastAssistantText()).toBe("finished after the cut")
    expect(observed).toEqual(["message_end", "agent_end", "agent_idle"])
    expect(handle.hasExited()).toBe(false)
    expect(handle.attached).toBe(true)
    expect(handle.openDisposition).toBe("attached")
    expect(promptsOn(host)).toEqual(["do the work"])
    await handle.dispose()
  })

  test("#given a turn in flight #when the host dies and comes back #then the handle reopens the path and re-prompts a continuation", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-b.jsonl", reopenOn(host))
    await handle.startInitialPrompt("do the work")

    // when: the host restarts (sessions gone, socket back) and the handle reattaches - the reattach
    // can re-prompt before restart() resolves, so the wait is registered before the trigger
    const continued = host.waitForCommand("prompt")
    await host.restart()
    const continuation = await continued

    // then: the reopened session is idle, so the interrupted turn is re-prompted once
    expect(String(continuation.payload.message)).toContain(HOST_SESSION_REATTACH_TAG)
    expect(handle.hasExited()).toBe(false)
    expect(handle.attached).toBe(true)
    expect(handle.openDisposition).toBe("reopened")
    const reopened = host.sessions().find((session) => session.sessionPath === "/tmp/sessions/reattach-b.jsonl")
    if (reopened === undefined) throw new Error("the host did not reopen the session")
    expect(handle.hostSession.routingId).toBe(reopened.routingId)
    host.completeTurn(reopened.routingId, "finished after the restart")
    expect((await handle.waitForOutcome()).status).toBe("completed")
    await handle.dispose()
  })

  test("#given a managed child mid-turn #when the host dies and the turn is re-prompted #then its managed stream reports the turn resumed after the continuation is acknowledged", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-resumed.jsonl", reopenOn(host))
    const observed: string[] = []
    const raw: string[] = []
    adaptRpcHandle(handle).subscribe((event) => observed.push(event.type))
    handle.subscribe((event) => raw.push(event.type))
    await handle.startInitialPrompt("do the work")

    // when
    await host.restart()
    const continuation = await host.waitForCommand("prompt")

    expect(observed).toEqual([]) // the prompt has reached the host, but its ACK has not reached recovery
    await handle.getEntries() // joins recovery after the prompt acknowledgement

    // then: the managed stream (what the footer widget reads) learns the turn is live again; the
    // host-event stream itself carries no synthesized event
    expect(String(continuation.payload.message)).toContain(HOST_SESSION_REATTACH_TAG)
    expect(observed).toEqual([HOST_TURN_RESUMED_EVENT])
    expect(raw).toEqual([])
    const reopened = host.sessions().find((session) => session.sessionPath === "/tmp/sessions/reattach-resumed.jsonl")
    if (reopened === undefined) throw new Error("the host did not reopen the session")
    host.completeTurn(reopened.routingId, "finished after the restart")
    expect((await handle.waitForOutcome()).status).toBe("completed")
    await handle.dispose()
  })

  test("#given a continuation awaiting acknowledgement #when the child cancels and delivery rejects #then recovery reports cancelled rather than lost", async () => {
    const continuation = Promise.withResolvers<void>()
    const promptSent = Promise.withResolvers<void>()
    const original = fakeSessionPort()
    const reopened = fakeSessionPort((command) => {
      if (command.type !== "prompt") return Promise.resolve()
      promptSent.resolve()
      return continuation.promise
    })
    const outcomes: string[] = []
    const observed: string[] = []
    const handle = createHostSessionHandle({
      client: original,
      session: FAKE_SESSION,
      taskId: "st_cancel_pending_continuation",
      heartbeatIntervalMs: 60_000,
      now: () => 13,
      closeGraceMs: 100,
      openDisposition: "attached",
      reattach: async () => ({ client: reopened, session: FAKE_SESSION, attached: false }),
      shardEvents: { onReattachOutcome: (info) => outcomes.push(info.outcome) },
    })
    adaptRpcHandle(handle).subscribe((event) => observed.push(event.type))
    await handle.startInitialPrompt("do the work")
    original.loseTransport()
    await promptSent.promise
    await handle.terminate()
    continuation.reject(new Error("continuation refused after cancellation"))
    await handle.getEntries()
    expect(outcomes).toEqual(["cancelled"])
    expect(observed).not.toContain(HOST_TURN_RESUMED_EVENT)
    await handle.dispose()
  })

  test("#given an idle child #when the host dies and comes back #then the handle reopens the path without re-prompting", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-c.jsonl", reopenOn(host))
    const observed: string[] = []
    adaptRpcHandle(handle).subscribe((event) => observed.push(event.type))
    await handle.startInitialPrompt("do the work")
    const first = host.sessions().find((session) => session.sessionPath === "/tmp/sessions/reattach-c.jsonl")
    if (first === undefined) throw new Error("the host did not open the session")
    host.completeTurn(first.routingId, "done")
    expect((await handle.waitForOutcome()).status).toBe("completed")
    // when: the host restarts and the next command waits for the reattach instead of failing
    await host.restart()
    await handle.steer("one more thing")

    // then: nothing was re-prompted; the steer is the only command after the restart
    expect(promptsOn(host)).toEqual(["do the work"])
    expect(host.commands.filter((command) => command.type === "steer").map((command) => command.payload.message)).toEqual([
      "one more thing",
    ])
    // no turn was running when the host died, so none is reported resumed
    expect(observed).not.toContain(HOST_TURN_RESUMED_EVENT)
    expect(handle.hasExited()).toBe(false)
    await handle.dispose()
  })

  test("#given the transport is lost #when every reattach attempt fails #then the child ends crashed with transport lost", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-d.jsonl", async () => undefined)
    await handle.startInitialPrompt("do the work")

    // when
    host.crash()

    // then
    expect(await handle.waitForExit()).toEqual({
      kind: "crashed",
      facts: { pid: undefined, code: null, signal: null, stderrTail: TRANSPORT_LOST_REASON },
    })
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })
})
