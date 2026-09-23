import { afterEach, describe, expect, test } from "bun:test"

import type { FakeHost } from "./__fixtures__/fake-host"
import { createHostSessionHandle } from "./handle"
import type { HostSessionChildHandle, HostSessionIdentity } from "./handle-port"
import { HOST_SESSION_REATTACH_TAG, type HostSessionReattach } from "./reattach"
import { childOpenInput } from "./session-client.test-support"
import { sessionClientHarness } from "./session-client.test-support"

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
    reattach,
  })
}

function promptsOn(host: FakeHost): string[] {
  return host.commands.filter((command) => command.type === "prompt").map((command) => String(command.payload.message))
}

describe("host-session handle reattach", () => {
  test("#given a turn in flight #when the connection is cut while the host keeps the session #then the handle re-joins it and the turn completes without a second prompt", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-a.jsonl", reopenOn(host))
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
    expect(handle.hasExited()).toBe(false)
    expect(handle.attached).toBe(true)
    expect(promptsOn(host)).toEqual(["do the work"])
    await handle.dispose()
  })

  test("#given a turn in flight #when the host dies and comes back #then the handle reopens the path and re-prompts a continuation", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-b.jsonl", reopenOn(host))
    await handle.startInitialPrompt("do the work")

    // when: the host restarts (sessions gone, socket back) and the handle reattaches
    await host.restart()
    const continuation = await host.waitForCommand("prompt")

    // then: the reopened session is idle, so the interrupted turn is re-prompted once
    expect(String(continuation.payload.message)).toContain(HOST_SESSION_REATTACH_TAG)
    expect(handle.hasExited()).toBe(false)
    expect(handle.attached).toBe(true)
    const reopened = host.sessions().find((session) => session.sessionPath === "/tmp/sessions/reattach-b.jsonl")
    if (reopened === undefined) throw new Error("the host did not reopen the session")
    expect(handle.hostSession.routingId).toBe(reopened.routingId)
    host.completeTurn(reopened.routingId, "finished after the restart")
    expect((await handle.waitForOutcome()).status).toBe("completed")
    await handle.dispose()
  })

  test("#given an idle child #when the host dies and comes back #then the handle reopens the path without re-prompting", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-c.jsonl", reopenOn(host))
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
    expect(handle.hasExited()).toBe(false)
    await handle.dispose()
  })

  test("#given the transport is lost #when every reattach attempt fails #then the child ends crashed with transport_gone", async () => {
    // given
    const host = await fakeHost()
    const handle = await openWithReattach(host, "/tmp/sessions/reattach-d.jsonl", async () => undefined)
    await handle.startInitialPrompt("do the work")

    // when
    host.crash()

    // then
    expect(await handle.waitForExit()).toEqual({
      kind: "crashed",
      facts: { pid: undefined, code: null, signal: null, stderrTail: "transport_gone" },
    })
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })
})
