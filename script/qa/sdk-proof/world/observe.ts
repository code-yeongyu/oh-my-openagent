// What device B shows after a step, read through B's own engine socket (never through the surface under test), and the
// step's verdict: the surface reported success in its own terms AND B shows the expected state. Waits re-check on the
// kit's event bus (engine records, fake-model requests, file events) under one bound; nothing sleeps.
import { waitFor } from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import type { Expect } from "../scenario.ts"
import { connectEngine, listSessions } from "./engine-port.ts"
import { type BState, isObject, verdictOf } from "./verdict.ts"

const SETTLE_MS = 60_000
// Twelve prompts of this filler put about 31k tokens in B's live context (measured on senpi 2026.11.23): a switch to an
// 80k-window model then needs a compaction first, so the holder parks it.
const FILL_PROMPTS = 12
const FILLER = "lorem ipsum ".repeat(1700)

type Client = Awaited<ReturnType<typeof connectEngine>>
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (isObject(part) && typeof part["text"] === "string" ? part["text"] : "")).join("")
      : ""

const dataOf = (reply: Record<string, unknown>): Record<string, unknown> =>
  isObject(reply["data"]) ? reply["data"] : {}

export type Observer = {
  /** The session B's engine holds for this run: the one its open made (absent before the open). */
  readonly adopt: (before: ReadonlySet<string>) => Promise<string | undefined>
  readonly keys: () => Promise<ReadonlySet<string>>
  readonly read: (key: string | undefined) => Promise<BState>
  /** `answered`: the surface reported success; only then is B given time to reach the state, else it is read once. */
  readonly judge: (
    key: string | undefined,
    expect: Expect,
    raw: unknown,
    answered: boolean,
  ) => Promise<{ ok: boolean; why: string; state: BState }>
  /** World setup, not a surface call: prompts B's thread directly until it fits a PARK_TO-sized window only after compaction. */
  readonly fill: (key: string | undefined) => Promise<void>
  readonly close: () => void
}

export async function observeB(socket: string, heldTags: () => readonly string[]): Promise<Observer> {
  const client: Client = await connectEngine(socket, "x1a-observe-b")
  const keys = async (): Promise<ReadonlySet<string>> => new Set((await listSessions(client)).map((row) => row.key))
  const read = async (key: string | undefined): Promise<BState> => {
    const held = heldTags()
    if (key === undefined || !(await keys()).has(key)) return { listed: false, streaming: false, messages: [], held }
    const state = dataOf(await client.request({ type: "get_state", sessionId: key }))
    const listed = dataOf(await client.request({ type: "get_messages", sessionId: key }))
    const model = isObject(state["model"])
      ? `${String(state["model"]["provider"])}/${String(state["model"]["id"])}`
      : undefined
    const messages = (Array.isArray(listed["messages"]) ? listed["messages"] : []).filter(isObject).map((message) => ({
      role: String(message["role"]),
      text: textOf(message["content"]),
      ...(typeof message["stopReason"] === "string" ? { stopReason: message["stopReason"] } : {}),
    }))
    return {
      listed: true,
      streaming: state["isStreaming"] === true,
      ...(model === undefined ? {} : { model }),
      ...(typeof state["thinkingLevel"] === "string" ? { thinking: state["thinkingLevel"] } : {}),
      ...(state["pendingModelSwitch"] == null ? {} : { pending: state["pendingModelSwitch"] }),
      messages,
      held,
    }
  }
  // A message sent to B arrives as the user's turn, or, delivered by the gateway from a session, as a custom entry that
  // carries the delivery header and the message; either is the message reaching B.
  const judge = async (key: string | undefined, expect: Expect, raw: unknown, answered: boolean) => {
    let state = await read(key)
    if (!answered) {
      const why = verdictOf(expect, state, raw)
      return { ok: why === undefined, why: why ?? "B shows the expected state", state }
    }
    try {
      state = await waitFor(
        async () => {
          const now = await read(key)
          return verdictOf(expect, now, raw) === undefined ? now : undefined
        },
        { label: `B shows ${expect.kind}`, timeoutMs: SETTLE_MS },
      )
    } catch {
      state = await read(key)
    }
    const why = verdictOf(expect, state, raw)
    return { ok: why === undefined, why: why ?? "B shows the expected state", state }
  }
  return {
    adopt: async (before) => [...(await keys())].find((key) => !before.has(key)),
    keys,
    read,
    judge,
    fill: async (key) => {
      if (key === undefined) return
      for (let i = 0; i < FILL_PROMPTS; i += 1) {
        const answers = async (): Promise<number> =>
          (await read(key)).messages.filter((message) => message.role === "assistant").length
        const before = await answers()
        await client.request({ type: "prompt", sessionId: key, message: `x1a fill ${i} ${FILLER}` })
        await waitFor(async () => ((await answers()) > before && !(await read(key)).streaming ? true : undefined), {
          label: "B answered a fill",
          timeoutMs: SETTLE_MS,
        })
      }
    },
    close: () => client.close(),
  }
}
