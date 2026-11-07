import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import type { JsonObject, RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

// A watcher that did not raise a dialog sees only the session's mirror of it (`ui_request_pending` / `ui_request_settled`):
// `omo remote watch` shows it with the command that answers it, and `omo remote answer` answers it by its uiRequestId.
const owners: FakeOwner[] = []
const dirs: string[] = []
const fixture = createRemoteThreadFixture()
afterEach(async () => {
  await fixture.cleanup()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function run(args: readonly string[], remote: RemoteThreadSurface) {
  const dir = mkdtempSync(join(tmpdir(), "remote-dialogs-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const owner = await startFakeOwner({ stateDir: dir, world: defaultWorld() })
  owners.push(owner)
  const out: string[] = []
  const err: string[] = []
  const code = await runRemoteVerb(
    {
      accountShow: async () => ({ exitCode: 0, stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }) }),
      stateDir: owner.stateDir,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      now: () => 1_790_000_400_000,
      output: line => out.push(line),
      write: () => {},
      error: line => err.push(line),
      bootstrap: undefined as never,
      remote: () => remote,
    },
    args,
  )
  return { code, out, err }
}

const select: JsonObject = { id: "dlg-1", type: "extension_ui_request", method: "select", title: "Which option?", options: ["A", "B"] }
const question: JsonObject = { id: "q-1", type: "extension_ui_request", method: "question", questions: [{ id: "q", question: "Ship it?", options: [{ label: "yes" }] }] }

// b's engine waiting on these dialogs: its get_state lists them, as senpi's does, and its answers are recorded.
function waitingOn(pendingDialogs: readonly JsonObject[], pendingQuestions: readonly JsonObject[] = [], refusal?: string) {
  const account = fixture.account()
  const answers: JsonObject[] = []
  const port = account.remote.sessions
  const remote: RemoteThreadSurface = {
    ...account.remote,
    sessions: {
      ...port,
      sessionCommand: async (device, sessionId, rpc, options) => {
        if (rpc["type"] === "get_state") return { kind: "ok", response: { type: "response", command: "get_state", success: true, data: { isStreaming: true, pendingDialogs: [...pendingDialogs], pendingQuestions: [...pendingQuestions] } } }
        if (rpc["type"] !== "extension_ui_response") return port.sessionCommand(device, sessionId, rpc, options)
        answers.push(rpc)
        return refusal === undefined ? { kind: "ok", response: { type: "response", command: "extension_ui_response", success: true, disposition: "applied" } } : { kind: "refused", reason: refusal }
      },
    },
  }
  return { ...account, remote, answers }
}

describe("omo remote: a dialog raised on another device's session", () => {
  test("#given a watched session mirrors a pending dialog and then its settling #when watch prints them #then it names the request, its choices and the command that answers it", async () => {
    const a = fixture.account({ engine: { messages: [], interrupt: {}, streaming: true, pending: 0 } })
    const done = run(["watch", "b/dur-on-b"], a.remote)
    await a.watching
    const [watch] = [...a.watchers]
    watch?.record({ type: "ui_request_pending", uiRequestId: "dlg-1", method: "select", request: select })
    watch?.record({ type: "ui_request_pending", uiRequestId: "q-1", method: "question", request: question })
    watch?.record({ type: "ui_request_settled", uiRequestId: "dlg-1", disposition: "answered" })
    a.endWatches("session_closed")
    const { code, out } = await done
    expect([code, out]).toEqual([REMOTE_EXIT.ok, [
      "Watching b/dur-on-b (running).",
      "b/dur-on-b asks (select): Which option? [A | B]",
      "  answer: omo remote answer b/dur-on-b dlg-1 <answer>",
      "b/dur-on-b asks (question): Ship it? [yes]",
      "  answer: omo remote answer b/dur-on-b q-1 <answer>",
      "b/dur-on-b request dlg-1 answered",
      "b/dur-on-b watch ended (session_closed)",
    ]])
  })

  test("#given the engine waits on a select #when answer names it #then one extension_ui_response carries the value under its uiRequestId", async () => {
    const b = waitingOn([select])
    const { code, out } = await run(["answer", "b/dur-on-b", "dlg-1", "B"], b.remote)
    expect([code, out]).toEqual([REMOTE_EXIT.ok, ["Answered dlg-1 on b/dur-on-b."]])
    expect(b.answers).toEqual([{ type: "extension_ui_response", sessionId: "dur-on-b", id: "dlg-1", uiRequestId: "dlg-1", value: "B" }])
  })

  test("#given a confirm and a question #when they are answered #then each gets the field its kind reads, and --cancel cancels", async () => {
    const confirm = { id: "c-1", type: "extension_ui_request", method: "confirm", title: "Run it?" }
    const b = waitingOn([confirm], [question])
    expect((await run(["answer", "b/dur-on-b", "c-1", "yes"], b.remote)).code).toBe(REMOTE_EXIT.ok)
    expect((await run(["answer", "b/dur-on-b", "q-1", "ship it"], b.remote)).code).toBe(REMOTE_EXIT.ok)
    expect((await run(["answer", "b/dur-on-b", "c-1", "--cancel"], b.remote)).code).toBe(REMOTE_EXIT.ok)
    expect(b.answers.map(({ type: _t, sessionId: _s, ...fields }) => fields)).toEqual([
      { id: "c-1", uiRequestId: "c-1", confirmed: true },
      { id: "q-1", uiRequestId: "q-1", answers: {}, comment: "ship it" },
      { id: "c-1", uiRequestId: "c-1", cancelled: true },
    ])
  })

  test("#given a confirm #when the answer is not yes or no #then nothing is sent and the accepted words are named", async () => {
    const b = waitingOn([{ id: "c-1", type: "extension_ui_request", method: "confirm", title: "Run it?" }])
    const { code, err } = await run(["answer", "b/dur-on-b", "c-1", "maybe"], b.remote)
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err[0]).toContain("yes or no")
    expect(b.answers).toEqual([])
  })

  test("#given a request the session no longer waits on #when answer names it #then the engine's refusal is reported and nothing counts as answered", async () => {
    const b = waitingOn([], [], "unknown_extension_ui_request")
    const { code, err } = await run(["answer", "b/dur-on-b", "gone-1", "B"], b.remote)
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err).toEqual([
      "omo remote: b/dur-on-b no longer waits on request gone-1 (unknown_extension_ui_request).",
      "Watch b/dur-on-b for what it asks now; nothing was answered.",
    ])
    expect(b.answers.map(answer => answer["uiRequestId"])).toEqual(["gone-1"])
  })

  test("#given answer without an answer #when it is parsed #then it is a usage error before the service is contacted", async () => {
    const b = waitingOn([select])
    const { code, err } = await run(["answer", "b/dur-on-b", "dlg-1"], b.remote)
    expect(code).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toBe("omo remote answer: the answer is required (or --cancel to cancel the request)")
    expect(b.answers).toEqual([])
  })
})
