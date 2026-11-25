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
const LEVELS = ["off", "low", "high"]

function scriptedHolder(
  mode: "apply" | "park" | "ignore",
  options: { readonly restoreFails?: boolean; readonly stateLostAfterSwitch?: boolean } = {},
) {
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
      if (options.stateLostAfterSwitch === true && calls.length > 0) throw new Error("the holder's state read was lost")
      return {
        isStreaming: false,
        model: { ...state.model, name: state.model.id },
        thinkingLevel: state.thinkingLevel,
        pendingModelSwitch: state.pending === undefined ? null : { ...state.pending },
      }
    },
    setModel: (provider: string, id: string): Model => {
      calls.push(`set_model ${provider}/${id}`)
      if (options.restoreFails === true && provider === PREVIOUS.provider && id === PREVIOUS.id)
        throw new Error("Previous model is no longer available")
      if (mode === "apply") {
        state.model = { provider, id }
        state.pending = undefined
      } else if (mode === "park") state.pending = { provider, id }
      return { provider, id }
    },
    setThinkingLevel: (level: string) => {
      calls.push(`set_thinking_level ${level}`)
      if (!LEVELS.includes(level)) throw new Error(`Thinking level ${level} is not supported by the active model.`)
      state.thinkingLevel = level
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
    setModel: async (_routing: string, provider: string, id: string) => holder.setModel(provider, id),
    getAvailableModels: async () => holder.models,
    setThinkingLevel: async (_routing: string, level: string) => {
      try {
        holder.setThinkingLevel(level)
      } catch (error) {
        throw new Error(`thinking_level_unsupported:${(error as Error).message}`)
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
      case "set_model":
        return ok(rpc, { ...holder.setModel(String(rpc["provider"]), String(rpc["modelId"])) })
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

async function switchOn(leg: keyof typeof LEGS, holder: Holder, model: string) {
  const result = await answered(() => setModelOn(LEGS[leg](holder), model, undefined))
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

    for (const model of ["anthropic/claude-small", "anthropic/claude-small:high"])
      test(`#given a ${leg} holder whose state names neither model #when switched to ${model} #then not_applied names what is in effect, never a partial commit`, async () => {
        const { result, holder, calls } = await switchOn(leg, scriptedHolder("ignore"), model)
        expect(result).toMatchObject({
          kind: "error",
          error: {
            code: "not_applied",
            details: {
              ...identity[leg],
              reason: "model_switch_not_applied",
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
            reason: "model_restore_failed",
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
  }
})
