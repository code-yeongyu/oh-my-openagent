/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStartWorkHook } from "./index"
import { clearBoulderState, readBoulderState } from "../../features/boulder-state"
import * as sessionState from "../../features/claude-code-session-state"

describe("start-work agent selection", () => {
  let testDir: string

  function createStartWorkPrompt(): string {
    return `<command-instruction>
You are starting a Sisyphus work session.
</command-instruction>

<session-context></session-context>`
  }

  function createMockPluginInput(model?: { providerID: string; modelID: string }) {
    return {
      directory: testDir,
      client: {
        session: {
          messages: async () => model ? [{ info: { model } }] : [],
        },
      },
    } as Parameters<typeof createStartWorkHook>[0]
  }

  beforeEach(() => {
    sessionState._resetForTesting()
    sessionState.registerAgentName("atlas")
    sessionState.registerAgentName("sisyphus")
    sessionState.registerAgentName("hephaestus")
    testDir = join(tmpdir(), `start-work-agent-test-${randomUUID()}`)
    mkdirSync(join(testDir, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".sisyphus", "plans", "worker-plan.md"), "# Plan\n- [ ] 1. Task")
    clearBoulderState(testDir)
  })

  afterEach(() => {
    sessionState._resetForTesting()
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("uses Hephaestus for GPT start-work sessions", async () => {
    const hook = createStartWorkHook(
      createMockPluginInput({ providerID: "openai", modelID: "gpt-5.3-codex" }),
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    await hook["chat.message"]({ sessionID: "ses-gpt-start-work" }, output)

    expect(output.message.agent).toBe("hephaestus")
    expect(sessionState.getSessionAgent("ses-gpt-start-work")).toBe("hephaestus")
    expect(readBoulderState(testDir)?.agent).toBe("hephaestus")
  })

  test("keeps Atlas for GPT-5.4 start-work sessions", async () => {
    const hook = createStartWorkHook(
      createMockPluginInput({ providerID: "openai", modelID: "gpt-5.4" }),
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    await hook["chat.message"]({ sessionID: "ses-gpt54-start-work" }, output)

    expect(output.message.agent).toBe("atlas")
    expect(sessionState.getSessionAgent("ses-gpt54-start-work")).toBe("atlas")
    expect(readBoulderState(testDir)?.agent).toBe("atlas")
  })
})
