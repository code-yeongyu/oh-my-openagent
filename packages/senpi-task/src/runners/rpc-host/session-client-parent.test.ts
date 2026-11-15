import { afterEach, describe, expect, test } from "bun:test"

import type { ChildDialogForwarder } from "../child-dialogs/forwarder"
import type { ForwardableDialog, ForwardedAnswer } from "../child-dialogs/forwardable-dialog"
import { ChildParentLink, type ParentPermissionMode } from "../parent-link"
import { HostSessionClient } from "./session-client"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"
import type { FakeHost } from "./__fixtures__/fake-host"

// #6189 F2d/F2e on the task-host runner's connection: a child's dialog is answered on the parent's UI, and the child
// opens in, then follows, its parent's approval mode.

const harness = sessionClientHarness()
const { fakeHost } = harness
const clients: HostSessionClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) await client.detach()
  await harness.release()
})

type Forwarded = { readonly dialog: ForwardableDialog; readonly taskId: string }

function recordingForwarder(answer: (dialog: ForwardableDialog) => ForwardedAnswer): {
  readonly forwarder: ChildDialogForwarder
  readonly seen: Forwarded[]
} {
  const seen: Forwarded[] = []
  return {
    seen,
    forwarder: {
      forward: async (dialog, child) => {
        seen.push({ dialog, taskId: child.taskId })
        return answer(dialog)
      },
    },
  }
}

function parentMode(initial: string): ParentPermissionMode & { change(preset: string): void } {
  let current = initial
  const listeners = new Set<(preset: string) => void>()
  return {
    current: () => current,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    change: (preset) => {
      current = preset
      for (const listener of listeners) listener(preset)
    },
  }
}

function linkedClient(
  host: FakeHost,
  parent: ChildParentLink,
  probe = () => host.probeProtocolInfo(),
): HostSessionClient {
  const client = new HostSessionClient({ socketPath: host.socketPath, ports: { probeProtocolInfo: probe }, parent })
  clients.push(client)
  return client
}

describe("HostSessionClient with a parent session", () => {
  test("#given a child permission prompt #when the parent answers Allow #then the child gets that answer with its tool call intact", async () => {
    // given
    const host = await fakeHost()
    const { forwarder, seen } = recordingForwarder(() => ({ kind: "value", value: "Allow" }))
    const client = linkedClient(host, new ChildParentLink("st_t16a", forwarder))
    const opened = await client.open(childOpenInput("/tmp/sessions/t16a.jsonl"))
    const answered = host.waitForCommand("extension_ui_response")

    // when
    host.requestUi(opened.sessionId, {
      id: "ui-allow",
      method: "select",
      title: "Run bash?",
      options: ["Allow", "Deny"],
      toolCallId: "call-7",
      parentToolCallId: "cell-2",
    })

    // then
    expect((await answered).payload).toMatchObject({ type: "extension_ui_response", id: "ui-allow", value: "Allow" })
    expect(seen).toEqual([
      {
        taskId: "st_t16a",
        dialog: {
          method: "select",
          title: "Run bash?",
          options: ["Allow", "Deny"],
          toolCallId: "call-7",
          parentToolCallId: "cell-2",
        },
      },
    ])
  })

  test("#given a child secret input #when it arrives #then it is never forwarded and the child gets the cancel", async () => {
    // given
    const host = await fakeHost()
    const { forwarder, seen } = recordingForwarder(() => ({ kind: "value", value: "leaked" }))
    const client = linkedClient(host, new ChildParentLink("st_t16a", forwarder))
    const opened = await client.open(childOpenInput("/tmp/sessions/t16a-secret.jsonl"))
    const answered = host.waitForCommand("extension_ui_response")

    // when
    host.requestUi(opened.sessionId, { id: "ui-secret", method: "input", title: "API key", secret: true })

    // then
    expect((await answered).payload).toMatchObject({ id: "ui-secret", cancelled: true })
    expect(seen).toEqual([])
  })

  test("#given a parent in full-access #when the child opens and the parent moves to ask #then the child opens in full-access and is moved to ask on its own path", async () => {
    // given
    const host = await fakeHost()
    const mode = parentMode("full-access")
    const client = linkedClient(host, new ChildParentLink("st_t17a", undefined, mode))
    const opened = await client.open(childOpenInput("/tmp/sessions/t17a.jsonl"))
    const reapplied = host.waitForCommand("open_session")

    // when
    mode.change("ask")

    // then
    const opens = host.commands.filter((command) => command.type === "open_session")
    expect(opens[0]?.payload).toMatchObject({
      sessionPath: "/tmp/sessions/t17a.jsonl",
      permissionPreset: "full-access",
    })
    expect((await reapplied).payload).toMatchObject({
      sessionPath: "/tmp/sessions/t17a.jsonl",
      permissionPreset: "ask",
    })
    expect(client.sessionId).toBe(opened.sessionId)
    expect(await client.getState()).toBeDefined()
  })

  // Review of 12839 (MEDIUM): a parent mode change while the child's own open is still in flight must reach the child.
  test("#given the parent moves to ask while the child is opening #when the open completes #then the child is moved to ask", async () => {
    // given
    const host = await fakeHost()
    const mode = parentMode("full-access")
    let moved = false
    const probe = () => {
      if (!moved) {
        moved = true
        mode.change("ask")
      }
      return host.probeProtocolInfo()
    }
    const client = linkedClient(host, new ChildParentLink("st_m1", undefined, mode), probe)
    const reapplied = within(host.waitForCommand("open_session", 2), "a re-open naming the parent's new mode")

    // when
    await client.open(childOpenInput("/tmp/sessions/m1.jsonl"))

    // then
    expect((await reapplied).payload).toMatchObject({ sessionPath: "/tmp/sessions/m1.jsonl", permissionPreset: "ask" })
  })

  // Review of 12839 (MEDIUM): rapid changes are applied one at a time, latest mode wins, never out of order.
  test("#given rapid parent changes ask, full-access, ask #when they are pushed #then one push runs at a time and the child ends in ask", async () => {
    // given
    const host = await fakeHost()
    const mode = parentMode("full-access")
    const gate = heldProbes(host)
    const client = linkedClient(host, new ChildParentLink("st_m2", undefined, mode), gate.probe)
    await client.open(childOpenInput("/tmp/sessions/m2.jsonl"))
    gate.hold()

    // when
    mode.change("ask")
    mode.change("full-access")
    mode.change("ask")
    await within(gate.firstHeld, "the first follow push to start")

    // then
    expect(gate.held()).toBe(1)
    const landed = host.waitForCommand("open_session")
    gate.releaseAll()
    expect((await within(landed, "the follow push to land")).payload).toMatchObject({ permissionPreset: "ask" })
  })
})

function within<T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${what}, never seen`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Probes pass straight through until hold(); then each waits for releaseAll(), so concurrent pushes are countable.
function heldProbes(host: FakeHost) {
  let holding = false
  const waiting: Array<() => void> = []
  const first = Promise.withResolvers<void>()
  return {
    firstHeld: first.promise,
    hold: () => {
      holding = true
    },
    held: () => waiting.length,
    releaseAll: () => {
      holding = false
      for (const release of waiting.splice(0)) release()
    },
    probe: async () => {
      if (holding) {
        const released = Promise.withResolvers<void>()
        waiting.push(released.resolve)
        first.resolve()
        await released.promise
      }
      return await host.probeProtocolInfo()
    },
  }
}
