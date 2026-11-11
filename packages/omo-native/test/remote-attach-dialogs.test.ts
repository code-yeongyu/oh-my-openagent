import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"

import type { JsonObject } from "../../device-service-core/src/index.ts"
import { defaultWorld, SESSION_ID } from "../../device-service-core/test/local-api/conformance/world.ts"
import { LOCAL_SESSION_ID } from "../remote-attach"
import { cleanupAttachFixtures, endpointFor, type Line, ownerState, TuiPeer } from "./remote-attach-support"

// relayd sends a dialog's local shape (extension_ui_request) only on the delegated connection that raised it; every other
// attach of the session sees the mirror, `ui_request_pending` and `ui_request_settled` (senpi snapshot-types.ts). The
// attach TUI reads only the local shape, so a viewer that did not raise the dialog must still see it and answer it.
afterEach(cleanupAttachFixtures)

const confirm = {
  id: "dlg-1",
  type: "extension_ui_request",
  method: "confirm",
  title: "Run it?",
  message: "rm -rf build",
  sessionId: "rpc-7",
}
const pending = (request: JsonObject): JsonObject => ({
  type: "ui_request_pending",
  uiRequestId: String(request.id),
  method: String(request.method),
  request,
  sessionId: "rpc-7",
})
const settled = (uiRequestId: string, disposition: "answered" | "cancelled"): JsonObject => ({
  type: "ui_request_settled",
  uiRequestId,
  disposition,
  sessionId: "rpc-7",
})
const MARKER: JsonObject = { type: "message_update", text: "after the dialogs" }

async function watcherOf(records: readonly JsonObject[]): Promise<TuiPeer> {
  const base = defaultWorld()
  const [session] = base.sessions
  if (session === undefined) throw new Error("the default world has a session")
  const endpoint = await endpointFor({ ...base, sessions: [{ ...session, records: [...records, MARKER] }] })
  const tui = await TuiPeer.connect(endpoint.socketPath)
  await tui.request({ type: "subscribe_sessions", sessions: { ids: [LOCAL_SESSION_ID] }, mirror: "all" })
  await tui.record((line) => line.type === "message_update", "the records after the dialogs")
  return tui
}

const dialogs = (tui: TuiPeer): Line[] =>
  tui.records.filter((line) => line.type === "extension_ui_request" && line.method !== "notify")

describe.skipIf(process.platform === "win32")("omo remote attach: a dialog raised on another connection", () => {
  test("#given a mirrored pending dialog #when the attach TUI watches #then it gets the dialog in the local shape under its uiRequestId", async () => {
    const tui = await watcherOf([pending(confirm)])
    expect(dialogs(tui)).toEqual([{ ...confirm, sessionId: LOCAL_SESSION_ID }])
    expect(tui.records.some((line) => line.type === "ui_request_pending")).toBe(false)
  })

  test("#given the TUI answers the mirrored dialog #when the answer reaches the host #then it names the dialog by uiRequestId on the attached session", async () => {
    const tui = await watcherOf([pending(confirm)])
    const answerId = randomUUID()
    const reply = await tui.answer({
      type: "extension_ui_response",
      id: "dlg-1",
      sessionId: LOCAL_SESSION_ID,
      confirmed: true,
      answerId,
    })
    expect([reply.id, reply.success]).toEqual(["dlg-1", true])
    expect(ownerState().commands).toEqual([
      {
        type: "extension_ui_response",
        id: "dlg-1",
        uiRequestId: "dlg-1",
        sessionId: SESSION_ID,
        confirmed: true,
        answerId,
      },
    ])
  })

  test("#given an answer that already names its request #when it is forwarded #then its own uiRequestId is kept", async () => {
    const tui = await watcherOf([])
    const secretAnswer = {
      type: "extension_ui_response",
      id: randomUUID(),
      uiRequestId: "secret-1",
      sessionId: LOCAL_SESSION_ID,
      value: "s",
      secret: true,
    }
    expect((await tui.answer(secretAnswer)).success).toBe(true)
    expect(ownerState().commands).toEqual([{ ...secretAnswer, sessionId: SESSION_ID }])
  })

  test("#given the dialog settles elsewhere #when the mirror says so #then the TUI gets the resolution it dismisses a dialog on", async () => {
    const tui = await watcherOf([pending(confirm), settled("dlg-1", "answered")])
    expect(tui.records.filter((line) => line.type === "question_resolved")).toEqual([
      { type: "question_resolved", id: "dlg-1", outcome: "answered", sessionId: LOCAL_SESSION_ID },
    ])
  })

  test("#given a secret input or a grant selection raised elsewhere #when it is mirrored #then the TUI is not shown a dialog only its raiser may answer", async () => {
    const secret = {
      id: "sec-1",
      type: "extension_ui_request",
      method: "input",
      title: "Token",
      secret: true,
      deadlineAtMs: Date.now() + 60_000,
    }
    const grant = {
      id: "grant-1",
      type: "extension_ui_request",
      method: "select",
      title: "Allow?",
      options: ["once", "always"],
      grantSelect: true,
    }
    const tui = await watcherOf([pending(secret), pending(grant), pending(confirm)])
    expect(dialogs(tui).map((line) => line.id)).toEqual(["dlg-1"])
  })
})
