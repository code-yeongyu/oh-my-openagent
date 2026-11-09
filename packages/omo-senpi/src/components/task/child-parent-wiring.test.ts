import { AsyncLocalStorage } from "node:async_hooks"
import { describe, expect, test } from "bun:test"

import { createForegroundDialogOrigins, type ForwardableDialog } from "@oh-my-opencode/senpi-task"

import type { DialogUi } from "../../extension/types"
import { createChildParentWiring } from "./child-parent-wiring"

// #6189 F2d/F2e, the parent's side: where a child's dialog is raised (a foreground child's on the connection that
// started the parent turn, a background child's to every attached answerer through pi.sessionDialog), when it is
// cancelled, and which mode a mode change hands the children.

const connection = new AsyncLocalStorage<string>()
const PROMPT: ForwardableDialog = { method: "select", title: "Run bash?", options: ["Allow once", "Deny"], toolCallId: "call-d", parentToolCallId: "cell-d" }

type Raised = { readonly via: string; readonly title: string; readonly opts: unknown; readonly connection: string | undefined }

function recordingUi(via: string, raised: Raised[], answer = "Allow once"): DialogUi {
  return {
    select: async (title, _options, opts) => { raised.push({ via, title, opts, connection: connection.getStore() }); return answer },
    confirm: async () => true,
  }
}

function harness() {
  const raised: Raised[] = []
  const changes: Array<() => void> = []
  let preset = "full-access"
  const origins = createForegroundDialogOrigins()
  const wiring = createChildParentWiring({
    pi: {
      events: { emit: () => {}, on: (name, handler) => { if (name === "permission_preset_changed") changes.push(() => handler({ permissionPreset: "x" })); return () => {} } },
      getPermissionPreset: () => preset,
      sessionDialog: recordingUi("session", raised),
    },
    runtime: { ui: () => ({ ...recordingUi("origin", raised), notify: () => {}, setStatus: () => {}, setWidget: () => {} }) },
    labelOf: (taskId) => `task ${taskId}`,
    origins,
  })
  return { raised, origins, wiring, change: (next: string) => { preset = next; changes.forEach((run) => run()) } }
}

describe("createChildParentWiring", () => {
  test("#given a background child #when it asks #then every attached answerer gets the prompt through sessionDialog", async () => {
    // given
    const { raised, wiring } = harness()

    // when
    const answer = await wiring.dialogForwarder.forward(PROMPT, { taskId: "st_bg", signal: new AbortController().signal })

    // then
    expect(answer).toEqual({ kind: "value", value: "Allow once" })
    expect(raised).toEqual([{ via: "session", title: "task st_bg: Run bash?", opts: expect.objectContaining({ toolCallId: "call-d", parentToolCallId: "cell-d" }), connection: undefined }])
  })

  test("#given a child the parent turn waits on #when it asks from outside that turn #then the prompt is raised in the turn's own connection context", async () => {
    // given
    const { raised, origins, wiring } = harness()
    const leave = connection.run("conn-origin", () => origins.enter("st_fg"))

    // when
    await wiring.dialogForwarder.forward(PROMPT, { taskId: "st_fg", signal: new AbortController().signal })
    leave()
    await wiring.dialogForwarder.forward(PROMPT, { taskId: "st_fg", signal: new AbortController().signal })

    // then
    expect(raised.map(({ via, connection: at }) => ({ via, at }))).toEqual([{ via: "origin", at: "conn-origin" }, { via: "session", at: undefined }])
  })

  test("#given a forwarded prompt #when the child task is cancelled #then the prompt's signal is aborted", async () => {
    // given
    const { raised, wiring } = harness()
    const child = new AbortController()
    await wiring.dialogForwarder.forward(PROMPT, { taskId: "st_bg", signal: child.signal })
    const signal = (raised[0]?.opts as { readonly signal: AbortSignal }).signal

    // when
    child.abort()

    // then
    expect(signal.aborted).toBe(true)
  })

  test("#given the parent mode changes #when the bus announces it #then children are handed this session's own mode", () => {
    // given
    const { wiring, change } = harness()
    const handed: string[] = []
    wiring.parentPermission.onChange((preset) => handed.push(preset))

    // when
    change("ask")

    // then
    expect(wiring.parentPermission.current()).toBe("ask")
    expect(handed).toEqual(["ask"])
  })
})
