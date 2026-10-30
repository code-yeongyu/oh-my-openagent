/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { answer, editResult, type FixtureEntry, passingTest, userInput } from "./entries.test-support"
import { CLAIM_RECEIPT_NUDGE_FLAG, type ClaimReceiptComponentOptions, createClaimReceiptComponent } from "./index"
import { createClaimReceiptRuntimeLoader } from "./runtime-loader"
import { NUDGE_MESSAGE_TYPE, VERDICT_ENTRY_TYPE } from "./verdict"

type Draft = { readonly type: string; readonly customType: string; readonly data?: unknown; readonly content?: unknown; readonly display?: boolean }

function setup(env: Record<string, string> = {}, nudge = true, options: ClaimReceiptComponentOptions = {}) {
  const pi = new FakeExtensionAPI()
  if (nudge) pi.setFlag(CLAIM_RECEIPT_NUDGE_FLAG, true)
  const warnings: string[] = []
  const ctx: ComponentContext = {
    logger: { debug() {}, info() {}, warn: (message: string) => warnings.push(message), error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  } as ComponentContext
  createClaimReceiptComponent(env, options).register(pi, ctx)
  let branch: FixtureEntry[] = []
  const eventCtx = { sessionManager: { getSessionId: () => "s1", getBranch: () => branch } }
  const finish = async (entries: FixtureEntry[], agentEnd: Record<string, unknown> = {}) => {
    branch = entries
    await pi.dispatch("agent_end", { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop", content: [] }], ...agentEnd }, eventCtx)
    const [result] = await pi.dispatch("agent_before_settle", { type: "agent_before_settle", outcome: "completed", entries: [{ type: "custom", customType: "other" }], continue: false }, eventCtx)
    return result as { entries?: Draft[]; continue?: boolean } | undefined
  }
  const input = (source: string) => pi.dispatch("input", { type: "input", text: "go", source }, eventCtx)
  const toolCall = (payload: Record<string, unknown>) => pi.dispatch("tool_call", payload, eventCtx)
  return { pi, finish, input, toolCall, warnings }
}

const unsupported = (): FixtureEntry[] => [userInput("fix"), ...editResult("e1", "src/a.ts"), answer("All tests pass.")]

describe("claim-receipt component", () => {
  describe("#given a final answer with an unsupported claim", () => {
    it("#then appends a verdict record and one visible nudge after the earlier drafts without continuing or sending", async () => {
      const { pi, finish, input } = setup()
      await input("interactive")
      const result = await finish(unsupported())
      expect(result?.continue).toBeUndefined()
      expect(result?.entries?.map((draft) => [draft.type, draft.customType])).toEqual([
        ["custom", "other"],
        ["custom", VERDICT_ENTRY_TYPE],
        ["custom_message", NUDGE_MESSAGE_TYPE],
      ])
      expect(result?.entries?.[2]?.display).toBe(true)
      expect(result?.entries?.[1]?.data).toMatchObject({ flagged: true, nudged: true, verdicts: [{ status: "unsupported", reason: "no-check" }] })
      expect(pi.messages).toEqual([])
    })
  })

  describe("#given repeated answers in one human-input epoch", () => {
    it("#then nudges once, keeps recording, and re-arms only on user-sourced input", async () => {
      const { finish, input } = setup()
      await input("interactive")
      expect((await finish(unsupported()))?.entries).toHaveLength(3)
      expect((await finish(unsupported()))?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE])
      await input("extension")
      expect((await finish(unsupported()))?.entries).toHaveLength(2)
      await input("rpc")
      expect((await finish(unsupported()))?.entries).toHaveLength(3)
    })
  })

  describe("#given a supported or claim-free answer", () => {
    it("#then records a supported verdict without a nudge, and adds nothing for an answer with no claim", async () => {
      const { finish } = setup()
      const supported = await finish([userInput("fix"), ...editResult("e1", "src/a.ts"), ...passingTest("t1"), answer("All tests pass.")])
      expect(supported?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE])
      expect(supported?.entries?.[1]?.data).toMatchObject({ flagged: false, nudged: false })
      expect(await finish([userInput("hi"), answer("Here is the summary you asked for.")])).toBeUndefined()
    })
  })

  describe("#given the verdict sidecar fails to load once", () => {
    it("#then that answer settles with no verdict and a warning, and the next answer loads it again", async () => {
      let imports = 0
      const loadRuntime = createClaimReceiptRuntimeLoader(async () => {
        imports += 1
        if (imports === 1) throw new Error("Cannot find module '#omo-claim-receipt-runtime'")
        return import("./runtime")
      })
      const { finish, input, warnings } = setup({}, true, { loadRuntime })
      await input("interactive")
      expect(await finish(unsupported())).toBeUndefined()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("extensions/omo-claim-receipt.js")
      expect((await finish(unsupported()))?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE, NUDGE_MESSAGE_TYPE])
      expect(imports).toBe(2)
    })
  })

  describe("#given the verdict sidecar keeps failing to load", () => {
    it("#then each failure streak warns once, and a failure after a successful load warns again", async () => {
      let imports = 0
      const loadRuntime = async () => {
        imports += 1
        if (imports === 3) return import("./runtime")
        throw new Error("Cannot find module '#omo-claim-receipt-runtime'")
      }
      const { finish, warnings } = setup({}, true, { loadRuntime })
      await finish(unsupported())
      await finish(unsupported())
      expect(warnings).toHaveLength(1)
      expect((await finish(unsupported()))?.entries?.map((draft) => draft.customType)).toContain(VERDICT_ENTRY_TYPE)
      await finish(unsupported())
      expect(warnings).toHaveLength(2)
      expect(imports).toBe(4)
    })
  })

  describe("#given a user message arrives while the verdict sidecar is still loading", () => {
    it("#then the earlier answer keeps its own epoch, shows no nudge and adds no gate flags, and the new message can still be nudged", async () => {
      let markCalled = (): void => {}
      const called = new Promise<void>((resolve) => {
        markCalled = resolve
      })
      let release = (): void => {}
      const gateOpen = new Promise<void>((resolve) => {
        release = resolve
      })
      const loadRuntime = createClaimReceiptRuntimeLoader(async () => {
        markCalled()
        await gateOpen
        return import("./runtime")
      })
      const { finish, input, toolCall } = setup({}, true, { loadRuntime })
      await input("interactive")
      const pending = finish(unsupported())
      await called
      await input("interactive")
      release()
      const stale = await pending
      expect(stale?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE])
      expect(stale?.entries?.[1]?.data).toMatchObject({ epoch: 1, flagged: true, nudged: false })
      const gate = { toolName: "task", input: { subagent_type: "omo-native-gate-reviewer", prompt: "Review it." } }
      await toolCall(gate)
      expect(gate.input.prompt).toBe("Review it.")
      const current = await finish(unsupported())
      expect(current?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE, NUDGE_MESSAGE_TYPE])
      expect(current?.entries?.[1]?.data).toMatchObject({ epoch: 2, nudged: true })
    })
  })

  describe("#given a run that did not finish cleanly", () => {
    it("#then stays out of aborted, retried and non-completed runs and memory worker children", async () => {
      const { finish } = setup()
      expect(await finish(unsupported(), { aborted: true })).toBeUndefined()
      expect(await finish(unsupported(), { willRetry: true })).toBeUndefined()
      const child = setup({ SENPI_MEMORY_FACTS: "1" })
      expect(await child.finish(unsupported())).toBeUndefined()
    })
  })

  describe("#given the default shadow mode (nudge flag not set)", () => {
    it("#then the flagged verdict is still recorded, but no nudge is shown and gate reviewers get no flags", async () => {
      const { finish, toolCall, input } = setup({}, false)
      await input("interactive")
      const result = await finish(unsupported())
      expect(result?.entries?.map((draft) => draft.customType)).toEqual(["other", VERDICT_ENTRY_TYPE])
      expect(result?.entries?.[1]?.data).toMatchObject({ flagged: true, nudged: false, verdicts: [{ status: "unsupported", reason: "no-check" }] })
      const gate = { toolName: "task", input: { subagent_type: "omo-native-gate-reviewer", prompt: "Review it." } }
      await toolCall(gate)
      expect(gate.input.prompt).toBe("Review it.")
    })
  })

  describe("#given unsupported claims since the last user input", () => {
    it("#then a gate reviewer spawn carries the flags and other spawns are untouched", async () => {
      const { finish, toolCall, input } = setup()
      await input("interactive")
      await finish(unsupported())
      const gate = { toolName: "task", input: { subagent_type: "omo-native-gate-reviewer", prompt: "Review it." } }
      const batch = { toolName: "task", input: { subagent_type: "omo-native-gate-reviewer", tasks: [{ prompt: "A" }, { subagent_type: "explore", prompt: "B" }] } }
      const explore = { toolName: "task", input: { subagent_type: "explore", prompt: "Look." } }
      await toolCall(gate)
      await toolCall(gate)
      await toolCall(batch)
      await toolCall(explore)
      expect(gate.input.prompt.match(/<claim-receipt-flags>/g)).toHaveLength(1)
      expect(gate.input.prompt).toContain("All tests pass.")
      expect(batch.input.tasks[0]?.prompt).toContain("<claim-receipt-flags>")
      expect(batch.input.tasks[1]?.prompt).toBe("B")
      expect(explore.input.prompt).toBe("Look.")
      await input("interactive")
      const later = { toolName: "task", input: { subagent_type: "omo-native-gate-reviewer", prompt: "Again." } }
      await toolCall(later)
      expect(later.input.prompt).toBe("Again.")
    })
  })
})
