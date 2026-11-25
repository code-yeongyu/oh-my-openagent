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
 * `pendingModelSwitch` in its state, as senpi does when the thread's context fits the new model only after compaction.
 */
type Model = { readonly provider: string; readonly id: string }

const PREVIOUS: Model = { provider: "openai", id: "gpt-x" }
const SELECTED: Model = { provider: "anthropic", id: "claude-small" }

function scriptedHolder(mode: "apply" | "park") {
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
    getState: (): JsonObject => ({
      isStreaming: false,
      model: { ...state.model, name: state.model.id },
      thinkingLevel: state.thinkingLevel,
      pendingModelSwitch: state.pending === undefined ? null : { ...state.pending },
    }),
    setModel: (provider: string, id: string): Model => {
      calls.push(`set_model ${provider}/${id}`)
      if (mode === "apply") {
        state.model = { provider, id }
        state.pending = undefined
      } else state.pending = { provider, id }
      return { provider, id }
    },
    setThinkingLevel: (level: string) => {
      calls.push(`set_thinking_level ${level}`)
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
    getState: async () => holder.getState(),
    setModel: async (_routing: string, provider: string, id: string) => holder.setModel(provider, id),
    getAvailableModels: async () => holder.models,
    setThinkingLevel: async (_routing: string, level: string) => holder.setThinkingLevel(level),
    getAvailableThinkingLevels: async () => ["off", "low", "high"],
    openSession: unused,
    getMessages: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
  } as unknown as ThreadHost
  return createLocalControl({ host } as ThreadToolSurfaceOptions, session, "dur-peer", "peer", () => [])
}

function relayControl(holder: Holder): SessionControl {
  const row: RemoteSessionRow = {
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
      case "get_state":
        return ok(rpc, holder.getState())
      case "set_model":
        return ok(rpc, { ...holder.setModel(String(rpc["provider"]), String(rpc["modelId"])) })
      case "set_thinking_level":
        holder.setThinkingLevel(String(rpc["level"]))
        return ok(rpc, {})
      default:
        throw new Error(`${String(rpc["type"])} is not part of a model switch`)
    }
  }
  return createRelayControl({ sessions: { sessionCommand } } as unknown as RemoteThreadSurface, row)
}

const LEGS = { here: localControl, other_device: relayControl } as const

async function switchOn(leg: keyof typeof LEGS, mode: "apply" | "park", model: string) {
  const holder = scriptedHolder(mode)
  const result = await answered(() => setModelOn(LEGS[leg](holder), model, undefined))
  return { result, holder: { ...holder.state }, calls: [...holder.calls] }
}

const identity = { here: { thread: "dur-peer" }, other_device: { thread: "dur-on-b", device: "b" } } as const

describe("#14939 pins: what thread_set_model answers today", () => {
  for (const leg of ["here", "other_device"] as const) {
    test(`#given a ${leg} holder that applies at once #when switched without a suffix #then ok names the model`, async () => {
      expect(await switchOn(leg, "apply", "anthropic/claude-small")).toEqual({
        result: { kind: "ok", ...identity[leg], model: SELECTED },
        holder: { model: SELECTED, thinkingLevel: "low", pending: undefined },
        calls: ["set_model anthropic/claude-small"],
      })
    })

    test(`#given a ${leg} holder that applies at once #when switched with a thinking suffix #then ok names the model only`, async () => {
      expect(await switchOn(leg, "apply", "anthropic/claude-small:high")).toEqual({
        result: { kind: "ok", ...identity[leg], model: SELECTED },
        holder: { model: SELECTED, thinkingLevel: "high", pending: undefined },
        calls: ["set_model anthropic/claude-small", "set_thinking_level high"],
      })
    })

    test(`#given a ${leg} holder that parks the switch #when switched without a suffix #then ok names the selected model although none is in effect`, async () => {
      expect(await switchOn(leg, "park", "anthropic/claude-small")).toEqual({
        result: { kind: "ok", ...identity[leg], model: SELECTED },
        holder: { model: PREVIOUS, thinkingLevel: "low", pending: SELECTED },
        calls: ["set_model anthropic/claude-small"],
      })
    })

    test(`#given a ${leg} holder that parks the switch #when switched with a thinking suffix #then partial_commit is answered with nothing applied`, async () => {
      expect(await switchOn(leg, "park", "anthropic/claude-small:high")).toEqual({
        result: {
          kind: "error",
          error: {
            code: "partial_commit",
            message: "The model and thinking change did not complete and the prior state could not be confirmed.",
            next_action: "Read the target's current model and thinking level before retrying.",
            details: {
              ...identity[leg],
              reason: "model_switch_unconfirmed",
              previous_model: PREVIOUS,
              previous_thinking_level: "low",
              selected_model: SELECTED,
              requested_thinking_level: "high",
            },
          },
        },
        holder: { model: PREVIOUS, thinkingLevel: "low", pending: SELECTED },
        calls: ["set_model anthropic/claude-small"],
      })
    })
  }
})
