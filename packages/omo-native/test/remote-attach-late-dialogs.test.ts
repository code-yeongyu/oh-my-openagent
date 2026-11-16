import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  CommandRpc,
  JsonObject,
  RemoteAttach,
  RemoteAttachEvent,
  SnapshotBody,
} from "../../device-service-core/src/index.ts"
import { LOCAL_SESSION_ID, type RemoteAttachEndpoint, serveRemoteAttach } from "../remote-attach"
import { type Line, TuiPeer } from "./remote-attach-support"

// A dialog raised before the attach, or while the relay link was down, reaches the attach only in a snapshot's
// state.pendingDialogs / state.pendingQuestions (omo#13474). The attach TUI reads those from get_state when it attaches,
// and nothing after that: so the endpoint must make them answerable by uiRequestId, keep raiser-only dialogs out, and
// present a later snapshot's (a re-attach's) dialogs itself.

const confirm = {
  id: "dlg-1",
  type: "extension_ui_request",
  method: "confirm",
  title: "Run it?",
  message: "rm -rf build",
}
const question = { id: "q-1", type: "extension_ui_request", method: "question", title: "Which?", options: ["a", "b"] }
const secret = { id: "sec-1", type: "extension_ui_request", method: "input", title: "Token", secret: true }
const later = { id: "dlg-2", type: "extension_ui_request", method: "confirm", title: "And this?", message: "ls" }

const snapshotOf = (
  attach_id: number,
  pendingDialogs: JsonObject[],
  pendingQuestions: JsonObject[] = [],
): SnapshotBody =>
  ({
    attach_id,
    entries: [],
    history_truncated: false,
    oldest_entry_id: null,
    state: { sessionId: "engine-1", isStreaming: true, pendingDialogs, pendingQuestions },
  }) as unknown as SnapshotBody

/** An attach whose events the test drives: a later onEvent listener replays from the latest snapshot, as the real one. */
class ScriptedAttach {
  readonly commands: CommandRpc[] = []
  private history: RemoteAttachEvent[] = []
  private readonly listeners = new Set<(event: RemoteAttachEvent) => void>()
  readonly attach: RemoteAttach

  constructor(first: SnapshotBody) {
    this.history = [{ kind: "snapshot", snapshot: first }]
    this.attach = {
      device: "Studio",
      sessionId: "durable-1",
      handle: "h-1",
      snapshot: Promise.resolve(first),
      detached: new Promise(() => {}),
      onEvent: (listener) => {
        for (const event of this.history) listener(event)
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      read: async () => ({ entries: [], next_before: null }),
      command: async (rpc) => {
        this.commands.push(rpc)
        return { outcome: { state: "engine_applied", retryable: false } as never }
      },
      onFrame: () => () => {},
      onChannelLoss: () => () => {},
      detach: async () => {},
      failure: () => undefined,
    }
  }

  emit(event: RemoteAttachEvent): void {
    if (event.kind === "snapshot") this.history = []
    this.history.push(event)
    for (const listener of [...this.listeners]) listener(event)
  }
}

const endpoints: RemoteAttachEndpoint[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The attach TUI's own sequence (senpi interactive/attach.ts): subscribe, then get_state, whose pending dialogs it shows. */
async function attachTui(script: ScriptedAttach): Promise<{ tui: TuiPeer; state: Line }> {
  const parent = mkdtempSync(join(tmpdir(), "ra-late-"))
  chmodSync(parent, 0o700)
  dirs.push(parent)
  const endpoint = await serveRemoteAttach(script.attach, { label: "Studio/s", parent })
  endpoints.push(endpoint)
  const tui = await TuiPeer.connect(endpoint.socketPath)
  await tui.request({ type: "subscribe_sessions", sessions: { ids: [LOCAL_SESSION_ID] }, mirror: "all" })
  const state = await tui.request({ type: "get_state", sessionId: LOCAL_SESSION_ID, observe: true })
  return { tui, state: state.data as Line }
}

describe.skipIf(process.platform === "win32")("omo remote attach: a dialog pending before the attach (#13474)", () => {
  test("#given a dialog and a question pending before the attach #when the TUI answers them #then each answer names its uiRequestId", async () => {
    const script = new ScriptedAttach(snapshotOf(1, [confirm], [question]))
    const { tui, state } = await attachTui(script)
    expect(state.pendingDialogs).toEqual([{ ...confirm, sessionId: LOCAL_SESSION_ID }])
    expect(state.pendingQuestions).toEqual([{ ...question, sessionId: LOCAL_SESSION_ID }])
    await tui.answer({ type: "extension_ui_response", id: "dlg-1", sessionId: LOCAL_SESSION_ID, confirmed: true })
    await tui.answer({ type: "extension_ui_response", id: "q-1", sessionId: LOCAL_SESSION_ID, value: "a" })
    expect(script.commands.map((rpc) => [rpc.id, rpc.uiRequestId, rpc.sessionId])).toEqual([
      ["dlg-1", "dlg-1", "durable-1"],
      ["q-1", "q-1", "durable-1"],
    ])
  })

  test("#given a secret input pending before the attach #when the TUI reads the state #then it is not offered a dialog only its raiser may answer", async () => {
    const { state } = await attachTui(new ScriptedAttach(snapshotOf(1, [secret, confirm])))
    expect((state.pendingDialogs as Line[]).map((dialog) => dialog.id)).toEqual(["dlg-1"])
  })

  test("#given a relay gap #when the re-attach snapshot holds a new dialog and lost a shown one #then the TUI is shown the new one and dismisses the lost one", async () => {
    const script = new ScriptedAttach(snapshotOf(1, [confirm]))
    const { tui } = await attachTui(script)
    script.emit({ kind: "snapshot", snapshot: snapshotOf(2, [later, secret]) })
    const shown = await tui.record(
      (line) => line.type === "extension_ui_request" && line.id === "dlg-2",
      "the re-attach dialog",
    )
    expect(shown).toEqual({ ...later, sessionId: LOCAL_SESSION_ID })
    const dismissed = await tui.record((line) => line.type === "question_resolved", "the dismissal of the lost dialog")
    expect(dismissed).toEqual({
      type: "question_resolved",
      id: "dlg-1",
      outcome: "cancelled",
      sessionId: LOCAL_SESSION_ID,
    })
    expect(tui.records.some((line) => line.id === "sec-1")).toBe(false)
    await tui.answer({ type: "extension_ui_response", id: "dlg-2", sessionId: LOCAL_SESSION_ID, confirmed: false })
    expect(script.commands.at(-1)?.uiRequestId).toBe("dlg-2")
  })

  test("#given a raiser-only dialog mirrored after the attach #when the re-attach snapshot no longer holds it #then the TUI that raised it dismisses it", async () => {
    // The raiser's TUI got the secret input through its own delegated frame; this endpoint learns it only from the mirror record.
    const script = new ScriptedAttach(snapshotOf(1, []))
    const { tui } = await attachTui(script)
    script.emit({
      kind: "records",
      attach_id: 1,
      records: [{ type: "ui_request_pending", uiRequestId: "sec-1", method: "input", request: secret }],
    })
    script.emit({ kind: "snapshot", snapshot: snapshotOf(2, [later]) })
    await tui.record((line) => line.type === "extension_ui_request" && line.id === "dlg-2", "the re-attach dialog")
    expect(tui.records.some((line) => line.type === "extension_ui_request" && line.id === "sec-1")).toBe(false)
    expect(tui.records.filter((line) => line.type === "question_resolved")).toEqual([
      { type: "question_resolved", id: "sec-1", outcome: "cancelled", sessionId: LOCAL_SESSION_ID },
    ])
  })

  test("#given a raiser-only dialog pending before a relay gap #when the re-attach snapshot no longer holds it #then the TUI that raised it dismisses it", async () => {
    // The raiser's TUI got the secret input through its own delegated frame; only the snapshot tells this endpoint it is pending.
    const script = new ScriptedAttach(snapshotOf(1, [secret]))
    const { tui } = await attachTui(script)
    script.emit({ kind: "snapshot", snapshot: snapshotOf(2, [later]) })
    await tui.record((line) => line.type === "extension_ui_request" && line.id === "dlg-2", "the re-attach dialog")
    expect(tui.records.filter((line) => line.type === "question_resolved")).toEqual([
      { type: "question_resolved", id: "sec-1", outcome: "cancelled", sessionId: LOCAL_SESSION_ID },
    ])
  })
})
