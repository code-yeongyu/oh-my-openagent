// What device B shows after a step, read through B's own engine socket (never through the surface under test), and the
// step's verdict: the surface reported success in its own terms AND B shows the expected state. Waits re-check on the
// kit's event bus (engine records, fake-model requests, file events) under one bound; nothing sleeps.
import { waitFor } from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import { ackOf, type Expect } from "../scenario.ts"
import { connectEngine, listSessions } from "./engine-port.ts"

const SETTLE_MS = 60_000

type Client = Awaited<ReturnType<typeof connectEngine>>
type Message = { readonly role: string; readonly text: string; readonly stopReason?: string }
export type BState = {
  readonly listed: boolean
  readonly streaming: boolean
  readonly model?: string
  readonly thinking?: string
  readonly pending?: unknown
  readonly messages: readonly Message[]
  readonly held: readonly string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

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
  const said = (state: BState, role: "user" | "assistant", needle: string): boolean =>
    state.messages.some(
      (message) =>
        (message.role === role || (role === "user" && message.role === "custom")) && message.text.includes(needle),
    )
  // The expected state, checked once B has had the chance to reach it (a wait that times out is a fail, not a throw).
  const holds = (expect: Expect, state: BState, raw: unknown): string | undefined => {
    switch (expect.kind) {
      case "exchange":
        return said(state, "user", expect.token) && said(state, "assistant", ackOf(expect.token)) && !state.streaming
          ? undefined
          : `B's transcript lacks the message or its answer ${ackOf(expect.token)}`
      case "answered":
        return JSON.stringify(raw).includes(ackOf(expect.token))
          ? undefined
          : `the read did not show ${ackOf(expect.token)}`
      case "holding":
        return state.held.includes(expect.tag) && state.streaming
          ? undefined
          : `B is not running a held turn ${expect.tag}`
      case "steered":
        return said(state, "assistant", `QA-RELEASED ${expect.tag}`) &&
          said(state, "user", expect.token) &&
          said(state, "assistant", ackOf(expect.token)) &&
          !state.streaming
          ? undefined
          : "B's transcript lacks the steered message or its answer"
      case "interrupted": {
        const last = state.messages.filter((message) => message.role === "assistant").at(-1)
        return !state.streaming && !state.held.includes(expect.tag) && last?.stopReason === "aborted"
          ? undefined
          : "B's held turn was not aborted"
      }
      case "model": {
        const wanted = `${expect.provider}/${expect.id}`
        if (state.model === wanted && state.thinking === expect.thinking) return undefined
        return state.pending !== undefined
          ? `B parked the switch until compaction (pending ${JSON.stringify(state.pending)})`
          : `B runs ${state.model ?? "?"} at ${state.thinking ?? "?"}, not ${wanted} at ${expect.thinking}`
      }
      case "closed":
        return state.listed ? "B still lists the thread" : undefined
    }
  }
  const judge = async (key: string | undefined, expect: Expect, raw: unknown, answered: boolean) => {
    let state = await read(key)
    if (!answered) {
      const why = holds(expect, state, raw)
      return { ok: why === undefined, why: why ?? "B shows the expected state", state }
    }
    try {
      state = await waitFor(
        async () => {
          const now = await read(key)
          return holds(expect, now, raw) === undefined ? now : undefined
        },
        { label: `B shows ${expect.kind}`, timeoutMs: SETTLE_MS },
      )
    } catch {
      state = await read(key)
    }
    const why = holds(expect, state, raw)
    return { ok: why === undefined, why: why ?? "B shows the expected state", state }
  }
  return {
    adopt: async (before) => [...(await keys())].find((key) => !before.has(key)),
    keys,
    read,
    judge,
    close: () => client.close(),
  }
}
