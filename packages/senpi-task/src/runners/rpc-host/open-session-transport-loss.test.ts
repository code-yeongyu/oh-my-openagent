import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../in-process/runner-error"
import { childSpec } from "../rpc-host.test-support"
import { HostUnavailableError } from "./daemon"
import { openTaskHostSession } from "./open-session"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
const { fakeHost, hostClient } = harness

afterEach(harness.release)

describe("open_session when the host dies mid-open", () => {
  test("#given an open in flight #when the host process dies #then the session client rejects with host_unreachable", async () => {
    // given
    const host = await fakeHost()
    host.withholdReply("open_session")
    const client = hostClient(host)
    const opening = client.open(childOpenInput("/tmp/sessions/mid-open.jsonl")).catch((error: unknown) => error)
    await host.waitForCommand("open_session")

    // when
    host.crash()
    const failure = await opening

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect(failure).toMatchObject({ reason: "host_unreachable", fallbackAllowed: false })
  })

  test("#given a child start whose host dies mid-open #when the start fails #then the runner error carries the host_unreachable reason", async () => {
    // given
    const host = await fakeHost()
    host.withholdReply("open_session")
    const client = hostClient(host)
    const starting = openTaskHostSession({ client, spec: childSpec(), sessionPath: "/tmp/sessions/mid-start.jsonl" })
      .catch((error: unknown) => error)
    await host.waitForCommand("open_session")

    // when
    host.crash()
    const failure = await starting

    // then
    expect(failure).toBeInstanceOf(HostUnavailableError)
    expect(RunnerError.is(failure)).toBe(false)
    expect(failure).toMatchObject({ reason: "host_unreachable" })
  })
})
