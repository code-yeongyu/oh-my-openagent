import { type ChildProcess, spawn } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { RpcProtocolClient } from "./protocol-client"
import { terminateRpcChild } from "./terminate"

const spawned: ChildProcess[] = []

afterEach(async () => {
  while (spawned.length > 0) {
    const child = spawned.pop()
    if (child) {
      await terminateRpcChild(child, { sigkillDelayMs: 200 })
    }
  }
})

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() > deadline) return reject(new Error("timed out waiting for model events"))
      setTimeout(tick, 5)
    }
    tick()
  })
}

describe("RpcProtocolClient model event forwarding (F12)", () => {
  test("#given a child that announces a model switch and a fallback revert #when both records arrive #then both fan out to subscribers with their payloads", async () => {
    // given: a child process that emits the two records on boot and then idles on stdin
    const source = [
      "const emit = (value) => process.stdout.write(JSON.stringify(value) + \"\\n\")",
      "emit({ type: \"model_changed\", model: { provider: \"anthropic\", id: \"claude-opus-5-5\" }, thinkingLevel: \"high\", source: \"set\" })",
      "emit({ type: \"retry_fallback_reverted\", from: \"anthropic/claude-opus-5-5\", to: \"kimi-coding/kimi-for-coding-highspeed-unlocked\" })",
      "process.stdin.resume()",
    ].join("\n")
    const child = spawn("node", ["--input-type=module", "-e", source], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    spawned.push(child)
    const client = new RpcProtocolClient({ child })
    const seen: Array<Record<string, unknown>> = []
    client.onEvent((event) => {
      seen.push(event as unknown as Record<string, unknown>)
    })

    // when
    await waitFor(() => seen.length >= 2)

    // then
    expect(seen.map((event) => event.type)).toEqual(["model_changed", "retry_fallback_reverted"])
    expect(seen[0]).toMatchObject({ model: { provider: "anthropic", id: "claude-opus-5-5" }, thinkingLevel: "high", source: "set" })
  })
})
