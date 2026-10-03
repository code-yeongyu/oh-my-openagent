import { expect, test } from "bun:test"

import { createHostSessionHandle } from "./handle"
import { FAKE_SESSION, fakeSessionPort } from "./handle.test-support"

test("#given close in flight #when terminate overlaps it #then the later terminated intent classifies the exit as killed", async () => {
  // given
  const closeGate = Promise.withResolvers<void>()
  const port = {
    ...fakeSessionPort(),
    close: () => closeGate.promise,
  }
  const handle = createHostSessionHandle({
    client: port,
    session: FAKE_SESSION,
    taskId: "overlapping-teardown",
    heartbeatIntervalMs: 60_000,
    now: () => 7,
    closeGraceMs: 60_000,
    openDisposition: "attached",
  })

  // when
  const closing = handle.close()
  const terminating = handle.terminate()
  closeGate.resolve()
  await Promise.all([closing, terminating])

  // then
  expect(handle.exitOutcome()?.kind).toBe("killed")
  await handle.dispose()
})

test("#given terminate in flight #when close overlaps it #then the exit stays killed and close_session is sent once", async () => {
  // given - terminate is still waiting for the host to acknowledge its abort
  const abortGate = Promise.withResolvers<void>()
  const port = fakeSessionPort((command) => (command.type === "abort" ? abortGate.promise : Promise.resolve()))
  const handle = createHostSessionHandle({
    client: port,
    session: FAKE_SESSION,
    taskId: "overlapping-teardown-reverse",
    heartbeatIntervalMs: 60_000,
    now: () => 7,
    closeGraceMs: 60_000,
    openDisposition: "attached",
  })

  // when
  const terminating = handle.terminate()
  const closing = handle.close()
  abortGate.resolve()
  await Promise.all([terminating, closing])

  // then
  expect(handle.exitOutcome()?.kind).toBe("killed")
  expect(port.closes).toBe(1)
  await handle.dispose()
})
