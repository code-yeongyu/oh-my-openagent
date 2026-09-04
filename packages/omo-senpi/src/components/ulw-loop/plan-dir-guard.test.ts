import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "./index"
import { activeStatus, createLogger, sessionEventCtx, statusArgsFor, TEST_SESSION_ID } from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop plan directory guard", () => {
  function withTempCwd(run: (cwd: string) => Promise<void>): Promise<void> {
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-ulw-guard-"))
    return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }))
  }

  async function registerWithRealPlanLookup(cwd: string): Promise<{
    pi: FakeExtensionAPI
    calls: Array<{ bin: string; args: readonly string[]; cwd: string }>
  }> {
    const pi = new FakeExtensionAPI()
    const calls: Array<{ bin: string; args: readonly string[]; cwd: string }> = []
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: async (bin, args, options) => {
        calls.push({ bin, args, cwd: options.cwd })
        return { code: 0, stdout: activeStatus() }
      },
    }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })
    return { pi, calls }
  }

  const steeringInput = { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" }

  it("#given a cwd without .omo/ulw-loop #when queued user input arrives #then no toolkit process is spawned", async () => {
    await withTempCwd(async (cwd) => {
      const { pi, calls } = await registerWithRealPlanLookup(cwd)

      const results = await pi.dispatch("input", steeringInput, sessionEventCtx(cwd))

      expect(calls).toEqual([])
      expect(results).toEqual([{ action: "continue" }])
    })
  })

  it("#given an unscoped plan in .omo/ulw-loop #when queued user input arrives #then no toolkit process is spawned", async () => {
    await withTempCwd(async (cwd) => {
      mkdirSync(join(cwd, ".omo", "ulw-loop"), { recursive: true })
      writeFileSync(join(cwd, ".omo", "ulw-loop", "goals.json"), activeStatus())
      const { pi, calls } = await registerWithRealPlanLookup(cwd)

      const results = await pi.dispatch("input", steeringInput, sessionEventCtx(cwd))

      expect(calls).toEqual([])
      expect(results).toEqual([{ action: "continue" }])
    })
  })

  it("#given .omo/ulw-loop exists but <sessionId>/goals.json does not #when queued user input arrives #then no toolkit process is spawned", async () => {
    await withTempCwd(async (cwd) => {
      mkdirSync(join(cwd, ".omo", "ulw-loop"), { recursive: true })
      const { pi, calls } = await registerWithRealPlanLookup(cwd)

      const results = await pi.dispatch("input", steeringInput, sessionEventCtx(cwd))

      expect(calls).toEqual([])
      expect(results).toEqual([{ action: "continue" }])
    })
  })

  it("#given only a session-scoped plan under .omo/ulw-loop #when queued user input arrives #then the toolkit is still consulted", async () => {
    await withTempCwd(async (cwd) => {
      mkdirSync(join(cwd, ".omo", "ulw-loop", TEST_SESSION_ID), { recursive: true })
      writeFileSync(join(cwd, ".omo", "ulw-loop", TEST_SESSION_ID, "goals.json"), activeStatus())
      const { pi, calls } = await registerWithRealPlanLookup(cwd)

      await pi.dispatch("input", steeringInput, sessionEventCtx(cwd))

      expect(calls).toEqual([{ bin: "/tmp/omo", args: statusArgsFor(), cwd }])
    })
  })
})
