import { type ChildProcess, spawn } from "node:child_process"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { afterEach, describe, expect, test } from "bun:test"

import { RpcProcessRunner } from "../rpc-process"
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

function spawnSessionCommandChild(): ChildProcess {
  const source = String.raw`
    import { createInterface } from "node:readline"
    const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n")
    createInterface({ input: process.stdin }).on("line", (line) => {
      const command = JSON.parse(line)
      emit({ type: "session_info_changed", name: "command:" + command.type })
      if (command.type === "switch_session") {
        emit({ type: "response", command: command.type, id: command.id, success: true, data: { cancelled: command.sessionPath.includes("cancel") } })
        return
      }
      if (command.type === "get_entries") {
        emit({ type: "response", command: command.type, id: command.id, success: true, data: { entries: [], leafId: command.since ?? null } })
        return
      }
      emit({ type: "response", command: command.type, id: command.id, success: true })
    })
  `
  return spawn("node", ["--input-type=module", "-e", source], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
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
  test(" w2reattach #given session RPC commands #when switching and reading entries #then typed command data is preserved", async () => {
    // given
    const client = new RpcProtocolClient({ child: track(spawnSessionCommandChild()) })

    // when
    const switched = await client.switchSession("/tmp/session.jsonl")
    const entries = await client.getEntries("entry-1")
    const cancelled = await client.switchSession("/tmp/cancel-session.jsonl")

    // then
    expect(switched).toEqual({ cancelled: false })
    expect(entries).toEqual({ entries: [], leafId: "entry-1" })
    expect(cancelled).toEqual({ cancelled: true })
  })

  test(" w2reattach #given a resume session path #when an RPC process starts #then it switches without replaying the prompt", async () => {
    // given
    const child = track(spawnSessionCommandChild())
    const runner = new RpcProcessRunner({
      heartbeatIntervalMs: 60_000,
      buildSpawn: (spec) => ({ command: process.execPath, args: [], cwd: spec.cwd, env: process.env }),
      spawnChild: () => child,
    })
    const events: AgentSessionEvent[] = []

    // when
    const handle = runner.start({
      task_id: "st_0000000f",
      cwd: process.cwd(),
      state_dir: "/tmp/unused",
      prompt: "must-not-replay",
      resumeSessionPath: "/tmp/session.jsonl",
    })
    handle.subscribe((event) => events.push(event))
    if (handle.switchSession === undefined) throw new Error("switchSession was not exposed")
    const result = await handle.switchSession("/tmp/session.jsonl")
    await waitFor(() => events.some((event) => event.type === "session_info_changed"))

    // then
    expect(result).toEqual({ cancelled: false })
    const names = events.flatMap((event) => event.type === "session_info_changed" ? [event.name] : [])
    expect(names).toContain("command:switch_session")
    expect(names).not.toContain("command:prompt")
  })

  test(" w2reattach #given inherited RPC extensions #when the process runner starts #then its effective spawn facts expose them for persistence", () => {
    // given
    const child = track(spawnSessionCommandChild())
    const runner = new RpcProcessRunner({
      inheritedExtensions: ["/tmp/inherited-extension.ts"],
      buildSpawn: (spec) => ({ command: process.execPath, args: [], cwd: spec.cwd, env: process.env }),
      spawnChild: () => child,
    })

    // when
    const handle = runner.start({
      task_id: "st_0000001f",
      cwd: "/tmp/project",
      state_dir: "/tmp/unused",
      prompt: "bootstrap",
      memberEnv: { SENPI_TASK_MEMBER: "run-1::alpha" },
    })

    // then
    expect(handle.spawnSpec).toEqual({
      cwd: "/tmp/project",
      extensions: ["/tmp/inherited-extension.ts"],
      memberEnv: { SENPI_TASK_MEMBER: "run-1::alpha" },
    })
  })

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
