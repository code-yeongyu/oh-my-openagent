import { describe, expect, test } from "bun:test"

import { createPostHogTestGuard } from "./posthog-test-guard"

function fakeClientClass() {
  const sent: string[] = []
  class FakeClient {
    disabled = false
    timerCleared = false
    fetch(url: string, _options: unknown): Promise<unknown> {
      sent.push(url)
      return Promise.resolve({ status: 200 })
    }
    capture(..._args: unknown[]): unknown {
      return undefined
    }
    shutdown(..._args: unknown[]): Promise<unknown> {
      return Promise.resolve()
    }
    clearFlushTimer(): void {
      this.timerCleared = true
    }
  }
  return { FakeClient, sent, guard: createPostHogTestGuard(FakeClient.prototype) }
}

describe("PostHog test guard (#10394)", () => {
  test("#given a client that captures and shuts down within its test #when the test ends #then nothing is reported and loopback sends pass through", async () => {
    // given
    const { FakeClient, sent, guard } = fakeClientClass()
    guard.beginTest()
    const client = new FakeClient()

    // when
    client.capture({ event: "e" })
    await client.fetch("http://127.0.0.1:4318/batch/", {})
    await client.shutdown()

    // then
    expect(guard.endTest()).toEqual([])
    expect(sent).toEqual(["http://127.0.0.1:4318/batch/"])
  })

  test("#given a client left running #when its test ends #then it is reported and its later flush never reaches fetch", async () => {
    // given
    const { FakeClient, sent, guard } = fakeClientClass()
    guard.beginTest()
    const client = new FakeClient()
    client.capture({ event: "e" })

    // when
    const violations = guard.endTest()
    guard.beginTest()
    const lateFlush = client.fetch("http://127.0.0.1:4318/batch/", {})

    // then
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("never shut down")
    expect(client.disabled).toBe(true)
    expect(client.timerCleared).toBe(true)
    await expect(lateFlush).rejects.toThrow("outlived its test")
    expect(sent).toEqual([])
    expect(guard.endTest()).toHaveLength(1)
  })

  test("#given a client first used outside a test #when the next test runs #then the client is reported as suite-scoped and its sends are refused under that name", async () => {
    // given
    const { FakeClient, sent, guard } = fakeClientClass()
    const client = new FakeClient()
    client.capture({ event: "e" })

    // when
    guard.beginTest()
    const send = client.fetch("http://127.0.0.1:4318/batch/", {})

    // then
    await expect(send).rejects.toThrow("used outside a test")
    const violations = guard.endTest()
    expect(violations).toHaveLength(2)
    expect(violations.every((violation) => violation.includes("outside a test"))).toBe(true)
    expect(sent).toEqual([])
  })

  test("#given a client pointed at a real analytics host #when it sends #then the request is refused and reported", async () => {
    // given
    const { FakeClient, sent, guard } = fakeClientClass()
    guard.beginTest()
    const client = new FakeClient()

    // when
    const send = client.fetch("https://us.i.posthog.com/batch/", {})

    // then
    await expect(send).rejects.toThrow("never send product telemetry")
    await client.shutdown()
    const violations = guard.endTest()
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("https://us.i.posthog.com/batch/")
    expect(sent).toEqual([])
  })

  test("#given a client first used after the last test #when the run ends #then its use and its refused send are reported", async () => {
    // given
    const { FakeClient, sent, guard } = fakeClientClass()
    guard.beginTest()
    guard.endTest()
    const client = new FakeClient()
    client.capture({ event: "e" })
    await expect(client.fetch("http://127.0.0.1:4318/batch/", {})).rejects.toThrow("used outside a test")

    // when
    const violations = guard.endRun()

    // then
    expect(violations).toHaveLength(2)
    expect(violations.every((violation) => violation.includes("outside a test"))).toBe(true)
    expect(guard.endRun()).toEqual([])
    expect(sent).toEqual([])
  })

  test("#given a stale client that sends between two tests #when the next test runs #then the refused send is reported in that test", async () => {
    // given
    const { FakeClient, guard } = fakeClientClass()
    guard.beginTest()
    const client = new FakeClient()
    client.capture({ event: "e" })
    await client.shutdown()
    guard.endTest()
    await expect(client.fetch("http://127.0.0.1:4318/batch/", {})).rejects.toThrow("outlived its test")

    // when
    guard.beginTest()
    const violations = guard.endTest()

    // then
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("after its test ended")
  })
})
