// What device B shows after a step, read through B's own engine socket (never through the surface under test), and the
// step's verdict: the surface reported success in its own terms AND B shows the expected state. Waits re-check on the
// kit's event bus (engine records, fake-model requests, file events) under one bound; nothing sleeps.
import { waitFor } from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import { type Expect, METER_MODEL } from "../scenario.ts"
import { connectEngine, listSessions } from "./engine-port.ts"
import { type BState, isObject, verdictOf } from "./verdict.ts"

const SETTLE_MS = 60_000
// About 2.6k tokens of live context per prompt of this filler (measured on senpi 2026.11.23). A compaction keeps about
// 20k of recent context, so a switch parks only when live context is well above that: the fill stops at 26k (read by
// the meter after each prompt, since B may auto-compact a fill away) and the step asks for a window just below the
// requirement, which fits only once a compaction has freed the difference.
const FILL_TARGET_LIVE = 26_000
const FILL_PROMPTS_MAX = 24
const FILL_WAIT_MS = 180_000
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
  /** World setup: fills B's thread, then reads its switch requirement (or why the setup failed). */
  readonly fill: (key: string | undefined) => Promise<{ readonly failed: string } | { readonly requirement: number }>
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
      const why = verdictOf(expect, state, raw, key !== undefined)
      return { ok: why === undefined, why: why ?? "B shows the expected state", state }
    }
    try {
      state = await waitFor(
        async () => {
          const now = await read(key)
          return verdictOf(expect, now, raw, key !== undefined) === undefined ? now : undefined
        },
        // A turn after a held switch runs a compaction first (a model call of its own), slower on a loaded host.
        { label: `B shows ${expect.kind}`, timeoutMs: expect.kind === "applied" ? FILL_WAIT_MS : SETTLE_MS },
      )
    } catch {
      state = await read(key)
    }
    const why = verdictOf(expect, state, raw, key !== undefined)
    return { ok: why === undefined, why: why ?? "B shows the expected state", state }
  }
  return {
    adopt: async (before) => [...(await keys())].find((key) => !before.has(key)),
    keys,
    read,
    judge,
    fill: async (key) => {
      if (key === undefined) return { failed: "no thread on B to fill" }
      const idle = async (label: string): Promise<string | undefined> => {
        try {
          await waitFor(async () => ((await read(key)).streaming ? undefined : true), {
            label,
            timeoutMs: FILL_WAIT_MS,
          })
          return undefined
        } catch (error) {
          return `${label}: ${String(error).slice(0, 200)}`
        }
      }
      // The meter: a switch to a 256-token model is refused naming the thread's live context and switch requirement, and
      // changes nothing. B may auto-compact the fills away, so it is read after every fill until the target is reached.
      const meter = async (): Promise<{ readonly live: number; readonly requirement: number } | string> => {
        const metered = await client.request({
          type: "set_model",
          sessionId: key,
          provider: "mock",
          modelId: METER_MODEL,
        })
        const text = String(metered["error"] ?? "")
        const requirement = /of the (\d+)-token requirement/.exec(text)?.[1]
        const live = /live context (\d+)/.exec(text)?.[1]
        return metered["success"] === false && requirement !== undefined && live !== undefined
          ? { live: Number(live), requirement: Number(requirement) }
          : `B's switch requirement could not be read: ${JSON.stringify(metered).slice(0, 300)}`
      }
      const lives: number[] = []
      for (let i = 0; i < FILL_PROMPTS_MAX; i += 1) {
        const busy = await idle(`B idle before fill ${i}`)
        if (busy !== undefined) return { failed: busy }
        const reading = await meter()
        if (typeof reading === "string") return { failed: reading }
        lives.push(reading.live)
        if (reading.live >= FILL_TARGET_LIVE) return { requirement: reading.requirement }
        // B may be compacting after an earlier fill: that refusal is retried, any other ends the setup.
        let reply: Record<string, unknown> = {}
        try {
          reply = await waitFor(
            async () => {
              const sent = await client.request(
                { type: "prompt", sessionId: key, message: `x1a fill ${i} ${FILLER}` },
                { timeoutMs: FILL_WAIT_MS },
              )
              return sent["success"] === false && String(sent["error"]).includes("compaction is in progress")
                ? undefined
                : sent
            },
            { label: `B took fill ${i}`, timeoutMs: FILL_WAIT_MS },
          )
        } catch (error) {
          return { failed: `B did not take fill ${i} (${String(error).slice(0, 200)})` }
        }
        if (reply["success"] === false)
          return { failed: `B refused fill ${i}: ${JSON.stringify(reply["error"] ?? reply).slice(0, 300)}` }
      }
      return {
        failed: `B's live context never reached ${FILL_TARGET_LIVE} tokens (read after each fill: ${lives.join(", ")})`,
      }
    },
    close: () => client.close(),
  }
}
