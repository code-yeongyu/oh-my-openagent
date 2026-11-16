import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync } from "node:fs"
import * as fs from "node:fs/promises"
import { basename, dirname } from "node:path"

import { awaitWithinTestBudget, useTestTimeout } from "../../../../test-support/test-deadline"

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

function answering(choice: string): {
  readonly forwarder: ChildDialogForwarder
  readonly seen: { dialog: ForwardableDialog; taskId: string }[]
} {
  const seen: { dialog: ForwardableDialog; taskId: string }[] = []
  return {
    seen,
    forwarder: {
      forward: async (dialog, child) => {
        seen.push({ dialog, taskId: child.taskId })
        return { kind: "value", value: choice }
      },
    },
  }
}

async function runChild(
  choice: string,
  setup: {
    readonly settingsPreset?: string
    readonly liveParent?: boolean
    readonly ownApprovalMode?: { readonly allowTools: readonly string[] }
  } = { settingsPreset: "ask" },
): Promise<{ readonly machine: GatedChildMachine; readonly seen: { dialog: ForwardableDialog; taskId: string }[] }> {
  const machine = await createGatedChildMachine(
    setup.settingsPreset === undefined ? {} : { settingsPreset: setup.settingsPreset },
  )
  machines.push(machine)
  const parent = setup.liveParent === true ? await machine.openParent() : undefined
  const { forwarder, seen } = answering(choice)
  const handle = await new InProcessRunner({ dialogs: forwarder }).start({
    ...machine.spec("st_6189c", parent?.sessionId),
    ...(setup.ownApprovalMode === undefined ? {} : { ownApprovalMode: setup.ownApprovalMode }),
  })
  await handle.waitForIdle()
  await handle.abort()
  // Both sessions that were started on this machine's agent dir reach their barrier before the root goes (#13520).
  await handle.dispose()
  await parent?.dispose()
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

  // An engine-owned worker (facts extraction and the onboarding understand step both launch through the facts launch)
  // names its run, not a live session, as its parent. Its preset is the one the engine's resolver gives its OWN
  // settings - never looser, never inherited: only its own tools run without asking. A launch that copied a raw
  // preset flag or a looser mode into the child would let the "not its tool" rows run instead of asking. The probe
  // call is `write`, whose permission is `edit`; record_fact is its own permission.
  test.each([
    { name: "a delegated child whose parent is not live", setup: {}, asks: true },
    {
      name: "a worker on its own ask settings, the call being its own tool",
      setup: { settingsPreset: "ask", ownApprovalMode: { allowTools: ["edit"] } },
      asks: false,
    },
    {
      name: "a worker on its own ask settings, the call not being its tool",
      setup: { settingsPreset: "ask", ownApprovalMode: { allowTools: ["record_fact"] } },
      asks: true,
    },
    {
      name: "a worker on its own read-only settings, the call not being its tool",
      setup: { settingsPreset: "read-only", ownApprovalMode: { allowTools: ["record_fact"] } },
      asks: true,
    },
    {
      name: "a worker on the host default, the call not being its tool",
      setup: { ownApprovalMode: { allowTools: ["record_fact"] } },
      asks: false,
    },
  ])(
    "#given $name #when it makes a gated call #then it asks exactly when its own settings do",
    async ({ setup, asks }) => {
      // given / when
      const { machine, seen } = await runChild("Deny", setup)

      // then
      expect(seen).toHaveLength(asks ? 1 : 0)
      expect(machine.probeExists()).toBe(!asks)
    },
    30_000,
  )
})

describe("child session teardown (#13520)", () => {
  test("#given a child whose engine first-start writer is still pending #when its handle is disposed #then the writer cannot outlive the machine root", async () => {
    useTestTimeout(30_000)
    const machine = await createGatedChildMachine({ settingsPreset: "ask" })
    machines.push(machine)
    const root = dirname(machine.spec("st_6189w").cwd)
    const access = fs.access
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const accessSpy = spyOn(fs, "access").mockImplementation(async (path, mode) => {
      if (basename(String(path)) === ".fallback-log-v2") {
        started.resolve()
        await release.promise
      }
      return access(path, mode)
    })
    let disposing: Promise<void> | undefined
    let disposeSettled = false
    try {
      const handle = await new InProcessRunner({ dialogs: answering("Allow once").forwarder }).start(
        machine.spec("st_6189w"),
      )
      await handle.waitForIdle()
      await awaitWithinTestBudget(started.promise, "the child's first-start step to reach .fallback-log-v2")

      disposing = Promise.resolve(handle.dispose()).finally(() => {
        disposeSettled = true
      })
      for (let turn = 0; turn < 200; turn++) await new Promise((done) => setImmediate(done))
      expect(disposeSettled).toBe(false)

      release.resolve()
      await disposing
      machine.cleanup()
      expect(existsSync(root)).toBe(false)
    } finally {
      release.resolve()
      if (disposing !== undefined) await disposing.catch(() => {})
      accessSpy.mockRestore()
    }
  }, 30_000)
})
