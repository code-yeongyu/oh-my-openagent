import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { refusal } from "./refusal-texts"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// Design lane ruling on summary and attachments (omo#14943 T1b). Attachments: no leg carries one, so every surface that
// sends or creates with a first prompt answers the one typed refusal control.send_attachments_unsupported before any
// effect. Summary: thread_send keeps accepting it, carries it nowhere, and its answer says so with not_carried.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function world() {
  const a = account()
  const s = surface(a.remote)
  const ports = { host: s.host, store: s.store, remote: a.remote }
  const threads = { firstPromptWaitMs: 1 }
  const root = assembleOmoSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ports, threads }, {})
  const effects = [
    spyOn(s.store, "enqueue"),
    spyOn(s.host, "prompt"),
    spyOn(s.host, "openSession"),
    spyOn(a.remote.sessions, "sessionCommand"),
  ]
  return { s, root, sdk: s.sdk(), effects }
}
type World = ReturnType<typeof world>

const ATTACHMENT = { bytes: new Uint8Array([104, 105]), name: "a.txt" }

const SURFACES: ReadonlyArray<readonly [string, (w: World, thread: string) => Promise<unknown>]> = [
  ["tool thread_send", (w, thread) => w.s.run("thread_send", { thread, message: "hi", attachments: [ATTACHMENT] })],
  ["tool thread_create", (w) => w.s.run("thread_create", { name: "made", prompt: "hi", attachments: [ATTACHMENT] })],
  ["facade send", (w, thread) => w.sdk.send({ thread, text: "hi", attachments: [ATTACHMENT] } as never)],
  ["facade create", (w) => w.sdk.create({ name: "made", prompt: "hi", attachments: [ATTACHMENT] } as never)],
  ["root send", (w, thread) => w.root.threads.send({ thread, message: "hi", attachments: [ATTACHMENT] })],
  ["root create", (w) => w.root.threads.create({ name: "made", prompt: { message: "hi", attachments: [ATTACHMENT] } })],
]

type Refused = { readonly code: string; readonly message: string; readonly next_action: string; readonly details?: unknown }
const errorOf = (answer: unknown): Refused => {
  const value = answer as { readonly error?: Refused }
  if (value.error === undefined) throw new Error(`not a refusal: ${JSON.stringify(answer)}`)
  return value.error
}

describe("attachments are refused on every surface before any effect", () => {
  test.each(SURFACES.flatMap(([name, run]) => ["dur-local", "dur-on-b"].map((thread) => [name, thread, run] as const)))(
    "#given %s naming one attachment to %s #when it runs #then control.send_attachments_unsupported and nothing was sent or opened",
    async (_name, thread, run) => {
      const w = world()
      const error = errorOf(await run(w, thread))
      const { code, message, next_action } = refusal("control.send_attachments_unsupported", { count: "1" })
      expect(error).toMatchObject({ code, message, next_action, details: { field: "attachments", count: 1 } })
      for (const effect of w.effects) expect(effect).not.toHaveBeenCalled()
    },
  )
})

describe("thread_send accepts summary and says it was not carried", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given summary passed to %s #when thread_send runs #then the message is sent and the answer names not_carried summary",
    async (thread) => {
      const w = world()
      const answer = (await w.s.run("thread_send", { thread, message: "hi", summary: "a brief" })) as Record<
        string,
        unknown
      >
      expect(answer["kind"]).toBe("ok")
      expect(answer["not_carried"]).toEqual(["summary"])
    },
  )

  test("#given no summary #when thread_send runs #then the answer has no not_carried field", async () => {
    const w = world()
    const answer = (await w.s.run("thread_send", { thread: "dur-local", message: "hi" })) as Record<string, unknown>
    expect(answer["kind"]).toBe("ok")
    expect("not_carried" in answer).toBe(false)
  })
})
