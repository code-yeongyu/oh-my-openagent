import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadComponent } from "./component"
import { GATEWAY_PEER_REPLY_SENTENCE } from "./gateway/constants"
import { createGatewayStore } from "./gateway/store"
import { renderDeliveryText } from "./gateway/provenance"
import type { DeliveryRow } from "./gateway/types"
import type { ThreadHost } from "./tools"

function host(): ThreadHost {
  const unused = async (): Promise<never> => {
    throw new Error("unused host operation")
  }
  return {
    socket: "/tmp/thread-peer-reply.sock",
    listSessions: async () => [],
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
  }
}

type Handler = (payload: unknown, ctx?: unknown) => unknown
type PermissionRequest = {
  readonly permission: string
  readonly patterns: readonly string[]
  readonly always: readonly string[]
  readonly autoApproveAsk?: true
}
type CapturedTool = {
  readonly name: string
  readonly permissionParser?: (input: Record<string, unknown>, cwd: string) => readonly PermissionRequest[]
}

function component(agentDir: string) {
  const handlers = new Map<string, Handler[]>()
  const tools: CapturedTool[] = []
  const pi = {
    cwd: process.cwd(),
    registerTool(tool: CapturedTool) {
      tools.push(tool)
    },
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerCommand() {},
    registerFlag() {},
    getFlag() {
      return undefined
    },
    sendMessage() {},
    sendUserMessage() {},
  }
  const store = createGatewayStore({ agentDir })
  const logger = { info() {}, error() {}, warn() {} }
  createThreadComponent({
    host: host(),
    stateDirectory: join(agentDir, "state"),
    agentDir: () => agentDir,
    store,
  }).register(pi as never, { logger, config: { getFlag: () => undefined } } as never)
  const ctx = { sessionManager: { getSessionId: () => "receiver" } }
  const dispatch = async (event: string, payload: Record<string, unknown> = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx)
  }
  const send = tools.find((tool) => tool.name === "thread_send")
  if (send?.permissionParser === undefined) throw new Error("thread_send declares no permission parser")
  const parse = send.permissionParser
  return { store, dispatch, requests: (thread: string) => parse({ thread, message: "answer" }, process.cwd()) }
}

const ASK = [{ permission: "thread_send", patterns: ["*"], always: ["*"] }]
const SENDER = "0195f0c2-1a2b-7c3d-8e4f-a1b2c3d4e5f6"
const OTHER = "0195f0c2-1a2b-7c3d-8e4f-0f0e0d0c0b0a"
const REPLY = [{ permission: "thread_send", patterns: [SENDER], always: [SENDER], autoApproveAsk: true as const }]
const approved = (address: string) => [
  { permission: "thread_send", patterns: [address], always: [address], autoApproveAsk: true as const },
]
/**
 * The two legs a consumed delivery can arrive on (#13006): from a session on this device (the drain admits it in-process,
 * no origin stamp) or from another device (the engine stamps `remote_origin` on the entry, senpi#6233). The sender it
 * names is the same shape on both (`gateway/provenance.ts` `deliverySender` here, `relay-transport.ts` there).
 */
type Leg = "local" | "remote"
const LEGS: readonly Leg[] = ["local", "remote"]
const delivery = (sender: Record<string, unknown>, leg: Leg = "remote", id = "d-1") => ({
  message: {
    role: "custom",
    customType: "session_control_delivery",
    details: {
      delivery_id: leg === "remote" ? `device:b/${id}` : id,
      ...(leg === "remote" ? { remote_origin: { deviceId: "b" } } : {}),
      sender,
    },
  },
})

/** A message the engine starts on its own after the run settled: senpi's open-todo reminder, a goal continuation, a monitor wake (role custom, not a delivery). */
const engineStarted = { message: { role: "custom", customType: "senpi.todo-owed", content: "open todos remain" } }
/** The run's own final answer: an assistant message that calls no tool. */
const finalAnswer = { message: { role: "assistant", content: [{ type: "text", text: "done" }] } }

/**
 * Every address's decision after one consumed delivery from SENDER named "Planner Bot", then after the run settles, then
 * in a turn the engine starts on its own (decision 0027 section 6, #13042: the allowance lasts for the work the delivery
 * started), then after a message from someone else starts new work.
 */
async function replyDecisions(leg: Leg): Promise<Record<string, unknown>> {
  const agentDir = mkdtempSync(join(tmpdir(), `thr-peer-reply-${leg}-`))
  const { store, dispatch, requests } = component(agentDir)
  try {
    const before = requests(SENDER)
    await dispatch("agent_start")
    await dispatch("message_start", delivery({ kind: "agent", session_id: SENDER, name: "Planner Bot" }, leg))
    const decided = {
      before_any_delivery: before,
      sender_id: requests(SENDER),
      sender_name: requests("Planner Bot"),
      sender_name_respelled: requests("  planner bot "),
      other_id: requests(OTHER),
      other_name: requests("reviewer"),
    }
    await dispatch("message_end", finalAnswer)
    await dispatch("agent_settled")
    const after_settle = requests(SENDER)
    await dispatch("agent_start")
    await dispatch("message_start", engineStarted)
    const engine_turn = {
      engine_turn_sender_id: requests(SENDER),
      engine_turn_sender_name: requests("Planner Bot"),
      engine_turn_other_id: requests(OTHER),
    }
    await dispatch("message_end", finalAnswer)
    await dispatch("agent_settled")
    await dispatch("agent_start")
    await dispatch("message_start", { message: { role: "user", content: "a person typed" } })
    return { ...decided, after_settle, ...engine_turn, after_user_message: requests(SENDER) }
  } finally {
    await store.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  }
}

describe("#12886 a peer-delivered run replies to its sender", () => {
  test("#given a run woken by an agent's delivery #when it sends back to that agent's session id #then the request is scoped to it with the ask auto-approved, and any other target or spelling still asks", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-peer-reply-"))
    const { store, dispatch, requests } = component(agentDir)
    try {
      expect(requests(SENDER)).toEqual(ASK)
      await dispatch("agent_start")
      await dispatch("message_start", delivery({ kind: "agent", session_id: SENDER, name: "A" }))
      expect(requests(SENDER)).toEqual(REPLY)
      expect(requests(OTHER)).toEqual(ASK)
      // Decision 0027 section 6: the stated sender of a consumed delivery is a reply target by id or name, whatever its spelling class.
      await dispatch("message_start", delivery({ kind: "agent", session_id: "planner", name: "planner" }))
      expect(requests("planner")).toEqual(approved("planner"))
    } finally {
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  // #13006 acceptance 3: the decision is computed from the sender's identity; the leg the delivery took is not an input.
  test.each(LEGS)(
    "decision 0027: #given a run woken by a %s delivery that states the sender's name #when it sends back by that id or NAME (any spelling the resolver accepts) #then the ask is auto-approved from the delivery alone, an unrelated target still asks, and the allowance ends with the run",
    async (leg) => {
      expect(await replyDecisions(leg)).toEqual({
        before_any_delivery: ASK,
        sender_id: approved(SENDER),
        sender_name: approved("Planner Bot"),
        sender_name_respelled: approved("  planner bot "),
        other_id: ASK,
        other_name: ASK,
        // decision 0027 section 6 (#13042): a settle alone keeps the allowance; a turn the engine starts on its own is still the
        // delivery's work; a person's message starts new work and ends it.
        after_settle: approved(SENDER),
        engine_turn_sender_id: approved(SENDER),
        engine_turn_sender_name: approved("Planner Bot"),
        engine_turn_other_id: ASK,
        after_user_message: ASK,
      })
    },
  )

  test.each(LEGS)(
    "#13042: #given a run that answered a %s delivery from SENDER #when a delivery from OTHER starts new work after the settle #then OTHER is the reply target and SENDER asks again; a delivery that joins running work adds its sender instead",
    async (leg) => {
      const agentDir = mkdtempSync(join(tmpdir(), `thr-peer-reply-group-${leg}-`))
      const { store, dispatch, requests } = component(agentDir)
      try {
        await dispatch("agent_start")
        await dispatch("message_start", delivery({ kind: "agent", session_id: SENDER, name: "Planner Bot" }, leg))
        await dispatch("message_end", finalAnswer)
        await dispatch("agent_settled")
        await dispatch("agent_start")
        await dispatch("message_start", delivery({ kind: "agent", session_id: OTHER, name: "Reviewer" }, leg, "d-2"))
        expect({ sender: requests(SENDER), other: requests(OTHER) }).toEqual({ sender: ASK, other: approved(OTHER) })
        // Running work (no final answer yet): a third agent's delivery joins it, so both are reply targets.
        await dispatch("message_start", delivery({ kind: "agent", session_id: "planner", name: "planner" }, leg, "d-3"))
        expect({ other: requests(OTHER), third: requests("planner") }).toEqual({
          other: approved(OTHER),
          third: approved("planner"),
        })
        // After this group's final answer, a delivery from OTHER again starts a NEW group: only OTHER is approved, the third
        // agent of the earlier work is not (the allowance never outlives the work a delivery started).
        await dispatch("message_end", finalAnswer)
        await dispatch("agent_settled")
        await dispatch("agent_start")
        await dispatch("message_start", delivery({ kind: "agent", session_id: OTHER, name: "Reviewer" }, leg, "d-4"))
        expect({ other: requests(OTHER), third: requests("planner"), sender: requests(SENDER) }).toEqual({
          other: approved(OTHER),
          third: ASK,
          sender: ASK,
        })
      } finally {
        await store.dispose()
        rmSync(agentDir, { recursive: true, force: true })
      }
    },
  )

  test("#13006: #given the same delivery once from this device and once from device b #when every decision is compared #then the two legs are equal, key by key", async () => {
    expect(await replyDecisions("remote")).toEqual(await replyDecisions("local"))
  })

  test("#given a delivery whose sender is not an agent #when the run sends anywhere #then it still asks", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-peer-reply-"))
    const { store, dispatch, requests } = component(agentDir)
    try {
      await dispatch("agent_start")
      await dispatch("message_start", delivery({ kind: "external", platform: "slack" }))
      expect(requests(SENDER)).toEqual(ASK)
    } finally {
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given a peer agent's delivery #when it is rendered #then it tells the receiver how a reply reaches the sender", () => {
    const envelope = {
      origin: { session: "sess-a" },
      actor: "planner",
      via: ["sess-a"],
      root_id: "root-1",
      hop: 1,
      delivery_id: "d-1",
    }
    const row = {
      delivery_id: "d-1",
      target_durable_id: "receiver",
      seq: 1,
      sender: "session:sess-a",
      sender_turn: null,
      envelope,
      body: "What is your hostname?",
      bytes: 22,
      mode_requested: "auto",
      mode_effective: null,
      expected_turn_id: null,
      state: "queued",
      reason: null,
      admitted_by: null,
      claimed_at: null,
      attempt: 0,
      admission_kind: null,
      wait_kind: null,
      turn_epoch: null,
      root_id: "root-1",
      hop: 1,
      created_at: 1,
      updated_at: 1,
      expires_at: 2,
      binding_id: null,
      binding_revision: null,
      actor_user_id: null,
    } satisfies DeliveryRow
    const [, sentence = ""] = renderDeliveryText(row).split("\n")
    expect(sentence).toContain(GATEWAY_PEER_REPLY_SENTENCE)
    // The thread family is eval-only, like bash (#12903): the sentence names the call the receiver can make.
    expect(GATEWAY_PEER_REPLY_SENTENCE).toContain("tool.thread_send(")
    expect(GATEWAY_PEER_REPLY_SENTENCE).toContain("eval")
    expect(GATEWAY_PEER_REPLY_SENTENCE).toContain("sender_session")
  })
})
