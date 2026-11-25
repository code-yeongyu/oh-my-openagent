import { describe, expect, test } from "bun:test"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"
import type { ThreadHost, ThreadHostSession, ThreadToolSurfaceOptions } from "../tools/ports"
import { createLocalControl } from "./local-control"
import { answered, setModelOn } from "./operations"
import type { SessionControl } from "./port"
import { createRelayControl } from "./relay-control"

/**
 * #14939: what `setModelOn` answers for a model switch, through each leg's real control over one scripted holder.
 * An `apply` holder puts the model in effect at once; a `park` holder keeps the old model and reports the switch as
 * `pendingModelSwitch` in its state, as senpi does when the thread's context fits the new model only after compaction;
 * an `ignore` holder acknowledges the switch and its state names neither model.
 */
type Model = { readonly provider: string; readonly id: string }

const PREVIOUS: Model = { provider: "openai", id: "gpt-x" }
const SELECTED: Model = { provider: "anthropic", id: "claude-small" }
/** A model no call in these cases asks for: another client's switch. */
const ELSEWHERE: Model = { provider: "google", id: "gemini-other" }
const LEVELS = ["off", "low", "high"]

/**
 * `drift`: another client switched the model meanwhile; `foreignPark`: the holder keeps a switch to another model.
 * `levelReplyLost`: the first level change applies and its reply is lost; `restoreLevelFails`: setting the level back
 * fails before it applies; `stateLostFrom`: every state read from that one (1-based) on fails.
 */
function scriptedHolder(
  mode: "apply" | "park" | "ignore" | "drift" | "foreignPark",
  options: {
    readonly restoreFails?: boolean
    readonly stateLostAfterSwitch?: boolean
    readonly loseFirstSwitchReply?: boolean
    readonly levelReplyLost?: boolean
    readonly restoreLevelFails?: boolean
    readonly stateLostFrom?: number
    /** Another client sets the level to `high` just before this state read (1-based) answers. */
    readonly driftLevelOnRead?: number
    /** A switch back to the previous model is acknowledged and not applied. */
    readonly restoreIgnored?: boolean
  } = {},
) {
  let reads = 0
  let levelRepliesToLose = options.levelReplyLost === true ? 1 : 0
  // The engine's effect ledger (senpi `runSetModel`): a repeated effect id replays its first answer and switches nothing.
  const effects = new Set<string>()
  let parks = 0
  let repliesToLose = options.loseFirstSwitchReply === true ? 1 : 0
  const state: { model: Model; thinkingLevel: string; pending: Model | undefined } = {
    model: PREVIOUS,
    thinkingLevel: "low",
    pending: undefined,
  }
  const calls: string[] = []
  return {
    state,
    calls,
    models: [PREVIOUS, SELECTED],
    getState: (): JsonObject => {
      reads += 1
      if (options.stateLostAfterSwitch === true && calls.length > 0) throw new Error("the holder's state read was lost")
      if (options.stateLostFrom !== undefined && reads >= options.stateLostFrom)
        throw new Error("the holder's state read was lost")
      if (options.driftLevelOnRead === reads) state.thinkingLevel = "high"
      return {
        isStreaming: false,
        model: { ...state.model, name: state.model.id },
        thinkingLevel: state.thinkingLevel,
        pendingModelSwitch: state.pending === undefined ? null : { ...state.pending },
      }
    },
    parks: () => parks,
    loseReply: () => {
      if (repliesToLose === 0) return false
      repliesToLose -= 1
      return true
    },
    setModel: (provider: string, id: string, effectId?: string): Model => {
      if (effectId !== undefined && effects.has(effectId)) {
        calls.push(`set_model replay ${effectId}`)
        return { provider, id }
      }
      if (effectId !== undefined) effects.add(effectId)
      calls.push(`set_model ${provider}/${id}`)
      if (options.restoreIgnored === true && provider === PREVIOUS.provider && id === PREVIOUS.id)
        return { provider, id }
      if (options.restoreFails === true && provider === PREVIOUS.provider && id === PREVIOUS.id)
        throw new Error("Previous model is no longer available")
      if (mode === "apply") {
        state.model = { provider, id }
        state.pending = undefined
      } else if (mode === "park") {
        state.pending = { provider, id }
        parks += 1
      } else if (mode === "drift") state.model = ELSEWHERE
      else if (mode === "foreignPark") state.pending = ELSEWHERE
      return { provider, id }
    },
    setThinkingLevel: (level: string) => {
      calls.push(`set_thinking_level ${level}`)
      if (!LEVELS.includes(level)) throw new Error(`Thinking level ${level} is not supported by the active model.`)
      if (options.restoreLevelFails === true && level === "low") throw new Error("the level could not be set back")
      state.thinkingLevel = level
      if (levelRepliesToLose > 0) {
        levelRepliesToLose -= 1
        throw new Error("the reply to set_thinking_level was lost")
      }
    },
  }
}

type Holder = ReturnType<typeof scriptedHolder>

function localControl(holder: Holder): SessionControl {
  const session: ThreadHostSession = { sessionId: "route-peer", durableSessionId: "dur-peer", cwd: "/work" }
  const unused = () => Promise.reject(new Error("not part of a model switch"))
  const host = {
    socket: "/tmp/set-model-pins.sock",
    listSessions: async () => [session],
    getState: async () => {
      try {
        return holder.getState()
      } catch (error) {
        throw new Error(`host_unavailable: ${(error as Error).message}`)
      }
    },
    setModel: async (_routing: string, provider: string, id: string, _durable?: string, effectId?: string) => {
      const switched = holder.setModel(provider, id, effectId)
      if (holder.loseReply()) throw new Error("transport_closed: the reply to set_model was lost")
      return switched
    },
    getAvailableModels: async () => holder.models,
    setThinkingLevel: async (_routing: string, level: string) => {
      try {
        holder.setThinkingLevel(level)
      } catch (error) {
        // The live surface rethrows only the engine's unsupported-level text this way; any other failure stays itself.
        const { message } = error as Error
        throw new Error(message.includes("is not supported") ? `thinking_level_unsupported:${message}` : message)
      }
    },
    getAvailableThinkingLevels: async () => LEVELS,
    openSession: unused,
    getMessages: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
  } as unknown as ThreadHost
  return createLocalControl({ host } as ThreadToolSurfaceOptions, session, "dur-peer", "peer", () => [])
}

function relayControl(holder: Holder): SessionControl {
  const row = {
    device: "b",
    session_id: "rk-on-b",
    durable_id: "dur-on-b",
    title: "peer on b",
    project: "/home/b/work",
    state: "idle",
  } as RemoteSessionRow
  const ok = (rpc: JsonObject, data: JsonObject): RemoteCommandOutcome => ({
    kind: "ok",
    response: { type: "response", id: null, command: rpc["type"] ?? null, success: true, data },
  })
  const sessionCommand = async (_device: string, _session: string, rpc: JsonObject): Promise<RemoteCommandOutcome> => {
    switch (rpc["type"]) {
      case "get_available_models":
        return ok(rpc, { models: holder.models.map((model) => ({ ...model })) })
      case "get_available_thinking_levels":
        return ok(rpc, { levels: [...LEVELS] })
      case "get_state":
        try {
          return ok(rpc, holder.getState())
        } catch {
          return { kind: "uncertain", reason: "request_gone" }
        }
      case "set_model": {
        const effectId = typeof rpc["effectId"] === "string" ? rpc["effectId"] : undefined
        const switched = holder.setModel(String(rpc["provider"]), String(rpc["modelId"]), effectId)
        if (holder.loseReply()) return { kind: "uncertain", reason: "reply_lost" }
        return ok(rpc, { ...switched })
      }
      case "set_thinking_level":
        try {
          holder.setThinkingLevel(String(rpc["level"]))
        } catch (error) {
          return { kind: "refused", reason: (error as Error).message }
        }
        return ok(rpc, {})
      default:
        throw new Error(`${String(rpc["type"])} is not part of a model switch`)
    }
  }
  return createRelayControl({ sessions: { sessionCommand } } as unknown as RemoteThreadSurface, row)
}

const LEGS = { here: localControl, other_device: relayControl } as const

async function switchOn(leg: keyof typeof LEGS, holder: Holder, model: string, effectId?: string) {
  const result = await answered(() =>
    setModelOn(LEGS[leg](holder), model, undefined, effectId === undefined ? undefined : { effectId }),
  )
  return { result, holder: { ...holder.state }, calls: [...holder.calls] }
}

const identity = { here: { thread: "dur-peer" }, other_device: { thread: "dur-on-b", device: "b" } } as const

describe("#14939 set_model outcomes: applied, after the next compaction, partly applied", () => {
  for (const leg of ["here", "other_device"] as const) {
    test(`#given a ${leg} holder that applies at once #when switched without a suffix #then the switch is applied with the state in effect`, async () => {
      expect(await switchOn(leg, scriptedHolder("apply"), "anthropic/claude-small")).toEqual({
        result: {
          kind: "ok",
          ...identity[leg],
          model: SELECTED,
          model_switch: "applied",
          in_effect: { model: SELECTED, thinking_level: "low" },
        },
        holder: { model: SELECTED, thinkingLevel: "low", pending: undefined },
        calls: ["set_model anthropic/claude-small"],
      })
    })

    test(`#given a ${leg} holder that applies at once #when switched with a thinking suffix #then model and level are both in effect`, async () => {
      expect(await switchOn(leg, scriptedHolder("apply"), "anthropic/claude-small:high")).toEqual({
        result: {
          kind: "ok",
          ...identity[leg],
          model: SELECTED,
          model_switch: "applied",
          in_effect: { model: SELECTED, thinking_level: "high" },
        },
        holder: { model: SELECTED, thinkingLevel: "high", pending: undefined },
        calls: ["set_model anthropic/claude-small", "set_thinking_level high"],
      })
    })

    test(`#given a ${leg} holder that parks the switch #when switched without a suffix #then the switch is pending and the old model is in effect`, async () => {
      expect(await switchOn(leg, scriptedHolder("park"), "anthropic/claude-small")).toEqual({
        result: {
          kind: "ok",
          ...identity[leg],
          model: SELECTED,
          model_switch: "after_compaction",
          in_effect: { model: PREVIOUS, thinking_level: "low" },
          pending: { model: SELECTED },
        },
        holder: { model: PREVIOUS, thinkingLevel: "low", pending: SELECTED },
        calls: ["set_model anthropic/claude-small"],
      })
    })

    test(`#given a ${leg} holder that parks the switch #when switched with a thinking suffix #then the switch is pending and the level is not sent to the old model`, async () => {
      expect(await switchOn(leg, scriptedHolder("park"), "anthropic/claude-small:high")).toEqual({
        result: {
          kind: "ok",
          ...identity[leg],
          model: SELECTED,
          model_switch: "after_compaction",
          in_effect: { model: PREVIOUS, thinking_level: "low" },
          pending: { model: SELECTED, thinking_level: "high", thinking_level_sent: false },
        },
        holder: { model: PREVIOUS, thinkingLevel: "low", pending: SELECTED },
        calls: ["set_model anthropic/claude-small"],
      })
    })

    // A plain switch reads no state before it, so it cannot say whether anything else moved (not_compared).
    for (const [model, reason] of [
      ["anthropic/claude-small", "not_compared"],
      ["anthropic/claude-small:high", "unchanged"],
    ] as const)
      test(`#given a ${leg} holder whose state names neither model #when switched to ${model} #then not_applied ${reason} names what is in effect, never a partial commit`, async () => {
        const { result, holder, calls } = await switchOn(leg, scriptedHolder("ignore"), model)
        expect(result).toMatchObject({
          kind: "error",
          error: {
            code: "not_applied",
            details: {
              ...identity[leg],
              reason,
              selected_model: SELECTED,
              in_effect: { model: PREVIOUS, thinking_level: "low" },
            },
          },
        })
        expect(result).not.toMatchObject({ error: { uncertain: true } })
        expect({ holder, calls }).toEqual({
          holder: { model: PREVIOUS, thinkingLevel: "low", pending: undefined },
          calls: ["set_model anthropic/claude-small"],
        })
      })

    for (const model of ["anthropic/claude-small", "anthropic/claude-small:high"])
      test(`#given a ${leg} holder whose state cannot be read after the switch #when switched to ${model} #then the outcome is uncertain and nothing more is sent`, async () => {
        const { result, calls } = await switchOn(leg, scriptedHolder("apply", { stateLostAfterSwitch: true }), model)
        expect(result).toMatchObject({
          kind: "error",
          error: {
            code: "idempotency_uncertain",
            uncertain: true,
            details: { ...identity[leg], reason: "model_switch_unconfirmed", selected_model: SELECTED },
          },
        })
        expect(calls).toEqual(["set_model anthropic/claude-small"])
      })

    test(`#given a ${leg} holder that applies the model, refuses the level and cannot restore #when switched with a suffix #then partial_commit names the model as applied and the level as not`, async () => {
      const { result, holder } = await switchOn(
        leg,
        scriptedHolder("apply", { restoreFails: true }),
        "anthropic/claude-small:max",
      )
      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "partial_commit",
          details: {
            ...identity[leg],
            reason: "rollback_incomplete",
            partial: {
              applied: ["model"],
              not_applied: ["thinking_level"],
              in_effect: { model: SELECTED, thinking_level: "low" },
            },
            selected_model: SELECTED,
            requested_thinking_level: "max",
          },
        },
      })
      expect(holder).toEqual({ model: SELECTED, thinkingLevel: "low", pending: undefined })
    })

    test(`#given a ${leg} holder whose level reply is lost and whose rollback restores the model but not the level #when switched with a suffix #then partial_commit lists only the level as applied`, async () => {
      const holder = scriptedHolder("apply", { levelReplyLost: true, restoreLevelFails: true })
      const { result } = await switchOn(leg, holder, "anthropic/claude-small:high")
      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "partial_commit",
          details: {
            ...identity[leg],
            reason: "rollback_incomplete",
            partial: {
              applied: ["thinking_level"],
              not_applied: ["model"],
              in_effect: { model: PREVIOUS, thinking_level: "high" },
            },
          },
        },
      })
      expect(holder.state).toEqual({ model: PREVIOUS, thinkingLevel: "high", pending: undefined })
    })

    test(`#given a ${leg} holder whose level reply is lost and whose rollback restores both parts #when switched with a suffix #then not_applied unchanged`, async () => {
      const holder = scriptedHolder("apply", { levelReplyLost: true })
      const { result } = await switchOn(leg, holder, "anthropic/claude-small:high")
      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "not_applied",
          details: { ...identity[leg], reason: "unchanged", in_effect: { model: PREVIOUS, thinking_level: "low" } },
        },
      })
      expect(result).not.toMatchObject({ error: { uncertain: true } })
      expect(holder.state).toEqual({ model: PREVIOUS, thinkingLevel: "low", pending: undefined })
    })

    test(`#given a ${leg} holder whose state cannot be read once its rollback ran #when switched with a suffix #then the outcome is uncertain, never a partial`, async () => {
      const holder = scriptedHolder("apply", { levelReplyLost: true, stateLostFrom: 5 })
      const { result } = await switchOn(leg, holder, "anthropic/claude-small:high")
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain", uncertain: true, details: { reason: "model_switch_unconfirmed" } },
      })
    })

    test(`#given a ${leg} holder already on the asked model #when its suffix is refused #then thinking_level_unsupported names what is in effect and nothing changed`, async () => {
      const holder = scriptedHolder("apply")
      const { result, calls } = await switchOn(leg, holder, "openai/gpt-x:max")
      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "thinking_level_unsupported",
          details: { supported: LEVELS, in_effect: { model: PREVIOUS, thinking_level: "low" } },
        },
      })
      expect(holder.state).toEqual({ model: PREVIOUS, thinkingLevel: "low", pending: undefined })
      expect(calls).toEqual(["set_model openai/gpt-x", "set_thinking_level max"])
    })

    for (const [mode, observed] of [
      ["drift", { in_effect: { model: ELSEWHERE, thinking_level: "low" } }],
      ["foreignPark", { in_effect: { model: PREVIOUS, thinking_level: "low" }, pending: { model: ELSEWHERE } }],
    ] as const)
      test(`#given a ${leg} holder whose state moved in a way this call did not ask for (${mode}) #when switched with a suffix #then not_applied changed_elsewhere carries what was observed`, async () => {
        const { result } = await switchOn(leg, scriptedHolder(mode), "anthropic/claude-small:high")
        expect(result).toMatchObject({
          kind: "error",
          error: { code: "not_applied", details: { ...identity[leg], reason: "changed_elsewhere", ...observed } },
        })
      })

    test(`#given a ${leg} holder whose level, asked at the value it had, is moved by another client while the model applies #when switched #then partial_commit changed_elsewhere, never applied`, async () => {
      const { result } = await switchOn(
        leg,
        scriptedHolder("apply", { driftLevelOnRead: 3 }),
        "anthropic/claude-small:low",
      )
      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "partial_commit",
          details: {
            ...identity[leg],
            reason: "changed_elsewhere",
            partial: {
              applied: ["model"],
              not_applied: ["thinking_level"],
              in_effect: { model: SELECTED, thinking_level: "high" },
            },
          },
        },
      })
    })

    test(`#given a ${leg} holder that acknowledges the switch back to the previous model without applying it #when a rollback runs #then the previous level is never written onto the selected model`, async () => {
      const holder = scriptedHolder("apply", { levelReplyLost: true, restoreIgnored: true })
      const { result, calls } = await switchOn(leg, holder, "anthropic/claude-small:high")
      expect(calls).toEqual(["set_model anthropic/claude-small", "set_thinking_level high", "set_model openai/gpt-x"])
      expect(result).toMatchObject({
        kind: "ok",
        model_switch: "applied",
        in_effect: { model: SELECTED, thinking_level: "high" },
      })
    })

    test(`#given a ${leg} holder that parked a switch under an effect id #when the same switch repeats under it #then the repeat answers the same pending outcome and parks nothing more`, async () => {
      const holder = scriptedHolder("park")
      const first = await switchOn(leg, holder, "anthropic/claude-small:high", "effect-1")
      const repeat = await switchOn(leg, holder, "anthropic/claude-small:high", "effect-1")
      expect(repeat.result).toEqual(first.result)
      expect(first.result).toMatchObject({ kind: "ok", model_switch: "after_compaction" })
      expect(holder.parks()).toBe(1)
      expect(repeat.calls).toEqual(["set_model anthropic/claude-small", "set_model replay effect-1"])
    })
  }

  test("#given the reply to a parked switch on another device is lost #when the switch repeats under the same effect id #then the repeat answers the pending outcome and parks nothing more", async () => {
    const holder = scriptedHolder("park", { loseFirstSwitchReply: true })
    const first = await switchOn("other_device", holder, "anthropic/claude-small:high", "effect-lost")
    expect(first.result).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    const repeat = await switchOn("other_device", holder, "anthropic/claude-small:high", "effect-lost")
    expect(repeat.result).toEqual({
      kind: "ok",
      ...identity.other_device,
      model: SELECTED,
      model_switch: "after_compaction",
      in_effect: { model: PREVIOUS, thinking_level: "low" },
      pending: { model: SELECTED, thinking_level: "high", thinking_level_sent: false },
    })
    expect(holder.parks()).toBe(1)
  })
})
