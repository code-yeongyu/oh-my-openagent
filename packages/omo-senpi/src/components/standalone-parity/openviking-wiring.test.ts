/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateStandaloneParity } from "../../../scripts/standalone-parity/generator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createStandaloneParityComponent } from "./index"
import type { OpenVikingLifecycle } from "./openviking"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone OpenViking wiring", () => {
  test("#given an OpenViking lifecycle #when a session starts and an agent turn begins #then injects initial and per-turn context", async () => {
    // given
    const fixture = await generatedFixture()
    const calls: string[] = []
    const lifecycle = fakeLifecycle(calls)
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ ...fixture, homeDir: join(fixture.betaRoot, "home"), openVikingLifecycle: lifecycle }).register(pi, context)
    await pi.dispatch("session_start", {}, { sessionId: "session-1" })

    // when
    const results = await pi.dispatch("before_agent_start", { systemPrompt: "BASE", prompt: "current question" }, { sessionId: "session-1" })

    // then
    const result = results[0]
    const systemPrompt = result === null || typeof result !== "object" ? "" : Reflect.get(result, "systemPrompt")
    expect(systemPrompt).toContain('<openviking-context source="session-start">\ninitial\n\nturn:current question\n</openviking-context>')
    expect(calls).toEqual(["start:session-1", "recall:session-1:current question"])
  })

  test("#given structured assistant and user message events #when message_end fires #then captures only assistant text with its event id", async () => {
    // given
    const fixture = await generatedFixture()
    const calls: string[] = []
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ ...fixture, homeDir: join(fixture.betaRoot, "home"), openVikingLifecycle: fakeLifecycle(calls) }).register(pi, context)

    // when
    await pi.dispatch("message_end", { message: { id: "user-1", role: "user", content: "question" } }, { sessionId: "session-1" })
    await pi.dispatch("message_end", { message: { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "answer" }] } }, { sessionId: "session-1" })

    // then
    expect(calls).toEqual(["capture:session-1:assistant:answer:assistant-1"])
  })

  test("#given compaction and shutdown events #when lifecycle boundaries fire #then commits and flushes the matching session", async () => {
    // given
    const fixture = await generatedFixture()
    const calls: string[] = []
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ ...fixture, homeDir: join(fixture.betaRoot, "home"), openVikingLifecycle: fakeLifecycle(calls) }).register(pi, context)

    // when
    await pi.dispatch("session_compact", { accepted: true }, { sessionId: "session-1" })
    await pi.dispatch("session_shutdown", {}, { sessionId: "session-1" })

    // then
    expect(calls).toEqual(["compact:session-1", "shutdown:session-1", "flushRetries"])
  })
})

const context = {
  logger: { info() {}, warn() {}, error() {} },
  config: { getFlag: () => undefined },
}

function fakeLifecycle(calls: string[]): OpenVikingLifecycle {
  return {
    start: async (sessionId) => { calls.push(`start:${sessionId}`); return "initial" },
    recall: async (sessionId, query) => { calls.push(`recall:${sessionId}:${query}`); return `turn:${query}` },
    capture: async (sessionId, role, content, eventId) => { calls.push(`capture:${sessionId}:${role}:${content}:${eventId ?? ""}`) },
    compact: async (sessionId) => { calls.push(`compact:${sessionId}`) },
    shutdown: async (sessionId) => { calls.push(`shutdown:${sessionId}`) },
    flushRetries: async () => { calls.push("flushRetries") },
  }
}

async function generatedFixture(): Promise<{ readonly betaRoot: string; readonly parityRoot: string }> {
  const betaRoot = await mkdtemp(join(tmpdir(), "omo-parity-openviking-wiring-"))
  roots.push(betaRoot)
  const sourceRoot = join(betaRoot, "source")
  const parityRoot = join(betaRoot, "standalone-parity")
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(join(sourceRoot, "AGENTS.md"), "# Context")
  await generateStandaloneParity({ outputRoot: parityRoot, skillRoots: [], commandRoots: [], instructionPaths: [join(sourceRoot, "AGENTS.md")] })
  return { betaRoot, parityRoot }
}
