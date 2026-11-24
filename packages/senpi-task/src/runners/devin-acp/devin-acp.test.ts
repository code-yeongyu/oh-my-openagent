import { spawn } from "node:child_process"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import type { ManagedStartSpec } from "../../manager/types"
import type { AcpSpawnDescriptor } from "./client"
import type { DevinAcpChildHandle } from "./handle"
import { DevinAcpRunner } from "./runner"

const FIXTURE = join(import.meta.dir, "__fixtures__", "fake-devin-acp.mjs")

function spec(overrides: Partial<ManagedStartSpec> = {}): ManagedStartSpec {
  return {
    taskId: "task-devin-1",
    cwd: "/tmp",
    stateDir: "/tmp/senpi-task-test",
    prompt: "Say PONG",
    depth: 1,
    parentSessionId: "parent-session",
    rootSessionId: "root-session",
    ...overrides,
  }
}

function runner(): DevinAcpRunner {
  return new DevinAcpRunner({
    spawnChild: (descriptor: AcpSpawnDescriptor) =>
      spawn(process.execPath, [FIXTURE], {
        cwd: descriptor.cwd,
        env: descriptor.env,
        stdio: ["pipe", "pipe", "pipe"],
      }),
  })
}

describe("DevinAcpRunner", () => {
  test("start prompts the session and resolves a completed outcome with streamed events", async () => {
    const r = runner()
    const handle = await r.start(spec())
    const first = await handle.waitForOutcome()
    expect(first.status).toBe("completed")
    if (first.status === "completed") expect(first.finalResponse).toBe("PONG")
    expect(handle.sessionId).toBe("fake-acp-session")
    expect(handle.pid).toBeGreaterThan(0)
    expect(handle.effectiveModel?.()?.id).toBe("adaptive")

    // Turn 1 settled before subscribe; a follow-up turn exercises the event synthesis path.
    const events: { type: string; [key: string]: unknown }[] = []
    handle.subscribe((event) => events.push(event as { type: string }))
    await handle.followUp("MULTI second turn")
    const second = await handle.waitForOutcome()
    expect(second.status).toBe("completed")
    if (second.status === "completed") expect(second.finalResponse).toBe("Hello world")
    const types = events.map((event) => event.type)
    expect(types).toContain("agent_start")
    expect(types).toContain("message_start")
    expect(types).toContain("message_end")
    expect(types).toContain("agent_end")
    expect(types).toContain("agent_idle")
    await handle.dispose()
    await r.settleTeardowns()
  })

  test("prompt failure surfaces as a child-turn-failed outcome", async () => {
    const r = runner()
    const handle = await r.start(spec({ prompt: "FAIL now" }))
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("error")
    if (outcome.status === "error") expect(outcome.failure.kind).toBe("child-turn-failed")
    await handle.dispose()
    await r.settleTeardowns()
  })

  test("steer cancels the in-flight turn and reprompts with the steering text", async () => {
    const r = runner()
    const handle = await r.start(spec({ prompt: "SLOW work" }))
    // Give the pump a beat to send session/prompt before steering.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await handle.steer("now do the fast thing")
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("completed")
    if (outcome.status === "completed") expect(outcome.finalResponse).toBe("PONG")
    await handle.dispose()
    await r.settleTeardowns()
  })

  test("abort cancels the in-flight turn and resolves cancelled", async () => {
    const r = runner()
    const handle = await r.start(spec({ prompt: "SLOW work" }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await handle.abort()
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("cancelled")
    await handle.dispose()
    await r.settleTeardowns()
  })

  test("malformed session/update params are ignored without throwing", async () => {
    const r = runner()
    const handle = (await r.start(spec({ prompt: "SLOW work" }))) as DevinAcpChildHandle
    const feed = (params: unknown) =>
      (handle as unknown as { onSessionUpdate(p: unknown): void }).onSessionUpdate(params)
    expect(() => feed(undefined)).not.toThrow()
    expect(() => feed(null)).not.toThrow()
    expect(() => feed({})).not.toThrow()
    expect(() => feed({ update: null })).not.toThrow()
    expect(() => feed({ update: "chunk" })).not.toThrow()
    expect(() => feed({ update: { sessionUpdate: "agent_message_chunk" } })).not.toThrow()
    await handle.abort()
    await handle.dispose()
    await r.settleTeardowns()
  })

  test("resume loads the persisted ACP session and stays idle until prompted", async () => {
    const r = runner()
    const handle = await r.resume(spec(), "fake-acp-session")
    expect(handle.sessionId).toBe("fake-acp-session")
    expect(handle.effectiveModel?.()?.id).toBe("swe-2-high")
    await handle.followUp("continue")
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("completed")
    if (outcome.status === "completed") expect(outcome.finalResponse).toBe("PONG")
    await handle.dispose()
    await r.settleTeardowns()
  })
})
