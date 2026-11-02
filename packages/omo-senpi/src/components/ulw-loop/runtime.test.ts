import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createAgentToolkit } from "../../extension/agent-toolkit-sdk"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "./index"
import { readUlwLoopStatusInProcess } from "./status-source"
import { createLogger, sessionEventCtx, TEST_SESSION_ID } from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop runtime", () => {
  it("#given built Senpi runs under Node #when inspecting runtime source #then the ulw-loop component has no Bun global dependency", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/\bBun\b/)
  })

  it("#given a real session plan #when input arrives with the default reader #then in-process status activates steering for its owner only", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-ulw-runtime-"))
    try {
      const seeded = await createAgentToolkit({ cwd, sessionId: TEST_SESSION_ID, surface: "omo-senpi" })
        .createGoals({ brief: "- alpha goal", force: true })
      expect(seeded.ok).toBe(true)
      const status = await readUlwLoopStatusInProcess(cwd, TEST_SESSION_ID)
      expect(status.code).toBe(0)
      expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, plan: { goals: expect.any(Array) } })

      const pi = new FakeExtensionAPI()
      await createUlwLoopComponent().register(pi, { logger: createLogger(), config: { getFlag: () => false } })
      const input = { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" }
      expect(await pi.dispatch("input", input, sessionEventCtx(cwd))).toEqual([expect.objectContaining({ action: "transform" })])
      expect(await pi.dispatch("input", input, sessionEventCtx(cwd, {
        sessionManager: { getSessionId: () => "unrelated-session" },
      }))).toEqual([{ action: "continue" }])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("#given readStatus returns ULW_LOOP_PLAN_MISSING #when input dispatches #then no warn entry is recorded", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const calls: Array<{ cwd: string; sessionId: string }> = []
    await createUlwLoopComponent({
      planExists: () => true,
      readStatus: async (cwd, sessionId) => {
        calls.push({ cwd, sessionId })
        return { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "ULW_LOOP_PLAN_MISSING", message: "plan not found" } }) }
      },
    }).register(pi, { logger, config: { getFlag: () => false } })

    const results = await pi.dispatch("input", {
      type: "input", text: "continue", source: "interactive", streamingBehavior: "steer",
    }, sessionEventCtx("/repo"))

    expect(calls).toEqual([{ cwd: "/repo", sessionId: TEST_SESSION_ID }])
    expect(results).toEqual([{ action: "continue" }])
    expect(logger.entries.filter((entry) => entry.level === "warn")).toEqual([])
  })

  it("#given readStatus returns ULW_LOOP_PLAN_INVALID #when input dispatches #then warn carries errorCode", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await createUlwLoopComponent({
      planExists: () => true,
      readStatus: async () => ({
        code: 1,
        stdout: JSON.stringify({ ok: false, error: { code: "ULW_LOOP_PLAN_INVALID", message: "invalid plan" } }),
      }),
    }).register(pi, { logger, config: { getFlag: () => false } })

    const results = await pi.dispatch("input", {
      type: "input", text: "continue", source: "interactive", streamingBehavior: "steer",
    }, sessionEventCtx("/repo"))

    expect(results).toEqual([{ action: "continue" }])
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "omo-senpi ulw-loop status ignored",
      details: { reason: "non-zero-exit", code: 1, errorCode: "ULW_LOOP_PLAN_INVALID" },
    })
  })
})
