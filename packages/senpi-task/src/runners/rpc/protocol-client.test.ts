import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { afterEach, describe, expect, test } from "bun:test"

import { spawnFakeChild } from "./__fixtures__/spawn-fake"
import { RpcProtocolClient } from "./protocol-client"
import { terminateRpcChild } from "./terminate"

const spawned: ChildProcess[] = []

function track(child: ChildProcess): ChildProcess {
  spawned.push(child)
  return child
}

afterEach(async () => {
  while (spawned.length > 0) {
    const child = spawned.pop()
    if (child) {
      await terminateRpcChild(child, { sigkillDelayMs: 200 })
    }
  }
})

function collectEvents(client: RpcProtocolClient): AgentSessionEvent[] {
  const events: AgentSessionEvent[] = []
  client.onEvent((event) => events.push(event))
  return events
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("RpcProtocolClient", () => {
  test("#given two in-flight requests answered out of order #when correlating #then each promise resolves by id", async () => {
    // given
    const client = new RpcProtocolClient({ child: track(spawnFakeChild()) })
    const order: string[] = []

    // when
    const slow = client.send({ type: "prompt", message: "delay:80:A" }).then((r) => {
      order.push("A")
      return r
    })
    const fast = client.send({ type: "prompt", message: "delay:20:B" }).then((r) => {
      order.push("B")
      return r
    })
    const [slowResponse, fastResponse] = await Promise.all([slow, fast])

    // then
    expect(order).toEqual(["B", "A"])
    expect(slowResponse.success).toBe(true)
    expect(fastResponse.success).toBe(true)
  })

  test("#given a completing turn #when subscribing #then agent lifecycle events fan out to every subscriber", async () => {
    // given
    const client = new RpcProtocolClient({ child: track(spawnFakeChild()) })
    const first = collectEvents(client)
    const second = collectEvents(client)

    // when
    await client.send({ type: "prompt", message: "hello" })
    await waitFor(() => first.some((e) => e.type === "agent_end"))

    // then
    expect(first.map((e) => e.type)).toContain("agent_start")
    expect(first.map((e) => e.type)).toContain("agent_end")
    expect(second.map((e) => e.type)).toContain("agent_end")
  })

  test("#given an extension_ui_request #when auto-answering #then the child receives a deny and never blocks", async () => {
    // given
    const client = new RpcProtocolClient({ child: track(spawnFakeChild({ ...process.env, FAKE_EMIT_UI: "1" })) })
    const events = collectEvents(client)

    // when
    await waitFor(() => events.some((e) => e.type === "session_info_changed"))

    // then
    const acked = events.find((e) => e.type === "session_info_changed")
    expect(acked && "name" in acked ? acked.name : undefined).toBe("ui:denied")
  })

  test("#given a malformed line #when parsing #then it is reported and the connection survives", async () => {
    // given
    const malformed: string[] = []
    const client = new RpcProtocolClient({
      child: track(spawnFakeChild({ ...process.env, FAKE_EMIT_MALFORMED: "1" })),
      onMalformedLine: (line) => malformed.push(line),
    })
    const events = collectEvents(client)

    // when
    await waitFor(() => events.some((e) => e.type === "agent_start"))

    // then
    expect(malformed).toContain("this-is-not-json")
    expect(events.map((e) => e.type)).toContain("agent_start")
  })

  test("#given a disposed client #when sending #then it rejects because the process is gone", async () => {
    // given
    const child = track(spawnFakeChild())
    const client = new RpcProtocolClient({ child })
    await terminateRpcChild(child, { sigkillDelayMs: 200 })
    await waitFor(() => client.exited)

    // when / then
    expect(client.send({ type: "get_state" })).rejects.toThrow()
  })
})
