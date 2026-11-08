import { afterEach, describe, expect, test } from "bun:test"

import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import type { ForwardableDialog } from "./child-dialogs/forwardable-dialog"
import { InProcessRunner } from "./in-process"
import { createGatedChildMachine, type GatedChildMachine } from "./in-process/__fixtures__/gated-child"

// #6189 F2d on the in-process runner: a child whose mode asks gets its permission prompt answered on the parent's UI
// (Allow runs the call, Deny does not), instead of the no-UI refusal it got before.

const machines: GatedChildMachine[] = []
afterEach(() => {
  for (const machine of machines.splice(0)) machine.cleanup()
})

function answering(choice: string): { readonly forwarder: ChildDialogForwarder; readonly seen: { dialog: ForwardableDialog; taskId: string }[] } {
  const seen: { dialog: ForwardableDialog; taskId: string }[] = []
  return { seen, forwarder: { forward: async (dialog, child) => { seen.push({ dialog, taskId: child.taskId }); return { kind: "value", value: choice } } } }
}

async function runChild(choice: string, setup: { readonly settingsPreset?: string; readonly liveParent?: boolean; readonly ownApprovalMode?: true } = { settingsPreset: "ask" }): Promise<{ readonly machine: GatedChildMachine; readonly seen: { dialog: ForwardableDialog; taskId: string }[] }> {
  const machine = await createGatedChildMachine(setup.settingsPreset === undefined ? {} : { settingsPreset: setup.settingsPreset })
  machines.push(machine)
  const parent = setup.liveParent === true ? await machine.openParent() : undefined
  const { forwarder, seen } = answering(choice)
  const handle = await new InProcessRunner({ dialogs: forwarder }).start({ ...machine.spec("st_6189c", parent?.sessionId), ...(setup.ownApprovalMode === undefined ? {} : { ownApprovalMode: true }) })
  await handle.waitForIdle()
  await handle.abort()
  parent?.dispose()
  return { machine, seen }
}

describe("InProcessRunner with a parent session", () => {
  test("#given a child whose gated call asks #when the parent answers Allow once #then the call runs and the prompt carried its tool call", async () => {
    // given / when
    const { machine, seen } = await runChild("Allow once")

    // then
    expect(machine.probeExists()).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ taskId: "st_6189c", dialog: { method: "select", toolCallId: "call-probe" } })
  }, 30_000)

  test("#given a child whose gated call asks #when the parent answers Deny #then the call does not run", async () => {
    // given / when
    const { machine, seen } = await runChild("Deny")

    // then
    expect(seen).toHaveLength(1)
    expect(machine.probeExists()).toBe(false)
  }, 30_000)

  // T11b (senpi#6206 rule 3, reached through the runner's spawnedBy): a child whose parent is not live in this
  // process asks; a child of a live host-default parent keeps the host default.
  test("#given a child whose parent is not live in this process #when it makes a gated call #then it asks the parent's UI", async () => {
    // given / when
    const { machine, seen } = await runChild("Deny", {})

    // then
    expect(seen).toHaveLength(1)
    expect(machine.probeExists()).toBe(false)
  }, 30_000)

  test("#given a child of a live host-default parent #when it makes a gated call #then it runs on the host default without asking", async () => {
    // given / when
    const { machine, seen } = await runChild("Deny", { liveParent: true })

    // then
    expect(seen).toHaveLength(0)
    expect(machine.probeExists()).toBe(true)
  }, 30_000)

  // An engine-owned worker (the facts extractor, the onboarding understand step) names its run, not a live session,
  // as its parent: it keeps the approval mode its own settings give it, exactly as before senpi 2026.11.6-3's rule 3,
  // and is never treated as a delegated child of a parent that is not there.
  test.each([
    { name: "a delegated child whose parent is not live", setup: {}, asks: true },
    { name: "an engine-owned worker under the host default", setup: { ownApprovalMode: true as const }, asks: false },
    { name: "an engine-owned worker whose own settings say ask", setup: { settingsPreset: "ask", ownApprovalMode: true as const }, asks: true },
  ])("#given $name #when it makes a gated call #then it asks only when its own rule says so", async ({ setup, asks }) => {
    // given / when
    const { machine, seen } = await runChild("Deny", setup)

    // then
    expect(seen).toHaveLength(asks ? 1 : 0)
    expect(machine.probeExists()).toBe(!asks)
  }, 30_000)
})
