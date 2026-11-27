// The verdict of a step on device B: undefined when B shows what the step expects (and, for a read or a model switch,
// when the surface's own answer carries it), else why not. Pure, so its negative controls are tests (sdk-proof.test.ts).
import { ackOf, type Expect } from "../scenario.ts"

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

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const said = (state: BState, role: "user" | "assistant", needle: string): boolean =>
  state.messages.some(
    (message) =>
      (message.role === role || (role === "user" && message.role === "custom")) && message.text.includes(needle),
  )
// The expected state, checked once B has had the chance to reach it (a wait that times out is a fail, not a throw).
export const verdictOf = (expect: Expect, state: BState, raw: unknown, adopted = true): string | undefined => {
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
    case "parked": {
      // #14939: the holder keeps the old model and holds the switch for its next compaction, and the surface answers
      // that defined success (model_switch after_compaction, with what is in effect and what is pending).
      const pending = isObject(state.pending)
        ? `${String(state.pending["provider"])}/${String(state.pending["id"])}`
        : undefined
      if (pending !== `${expect.provider}/${expect.id}`)
        return `B holds no pending switch to ${expect.provider}/${expect.id}`
      return JSON.stringify(raw).includes('"after_compaction"')
        ? undefined
        : "B parked the switch, but the surface did not answer the after-compaction outcome"
    }
    case "applied": {
      // #14939: the next turn compacts first, then the held switch applies: the asked model is in effect. Its level is
      // the step after (set-level), since the pinned engine's held switch carries none (senpi#7468).
      const wanted = `${expect.provider}/${expect.id}`
      const reasons = [
        ...(state.model === wanted ? [] : [`after the compaction B runs ${state.model ?? "?"}, not ${wanted}`]),
        ...(said(state, "user", expect.token) && said(state, "assistant", ackOf(expect.token)) && !state.streaming
          ? []
          : [`B's transcript lacks the message or its answer ${ackOf(expect.token)}`]),
      ]
      return reasons.length === 0 ? undefined : reasons.join("; ")
    }
    case "level": {
      const wanted = `${expect.provider}/${expect.id}`
      return state.model === wanted && state.thinking === expect.thinking
        ? undefined
        : `B runs ${state.model ?? "?"} at ${state.thinking ?? "?"}, not ${wanted} at ${expect.thinking}`
    }
    case "closed":
      // Absence proves a close only of a thread this surface's open made on B (adopted); with none it proves nothing.
      if (!adopted) return "no thread of this surface was adopted on B, so its absence proves no close"
      return state.listed ? "B still lists the thread" : undefined
  }
}
