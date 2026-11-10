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
  const unused = async (): Promise<never> => { throw new Error("unused host operation") }
  return {
    socket: "/tmp/thread-peer-reply.sock", listSessions: async () => [], openSession: unused, getMessages: unused,
    getState: unused, prompt: unused, interrupt: unused, setSessionName: unused, setModel: unused,
    getAvailableModels: unused, setThinkingLevel: unused, getAvailableThinkingLevels: unused,
  }
}

type Handler = (payload: unknown, ctx?: unknown) => unknown
type PermissionRequest = { readonly permission: string; readonly patterns: readonly string[]; readonly always: readonly string[]; readonly autoApproveAsk?: true }
type CapturedTool = { readonly name: string; readonly permissionParser?: (input: Record<string, unknown>, cwd: string) => readonly PermissionRequest[] }

function component(agentDir: string) {
  const handlers = new Map<string, Handler[]>()
  const tools: CapturedTool[] = []
  const pi = {
    cwd: process.cwd(), registerTool(tool: CapturedTool) { tools.push(tool) },
    on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    registerCommand() {}, registerFlag() {}, getFlag() { return undefined }, sendMessage() {}, sendUserMessage() {},
  }
  const store = createGatewayStore({ agentDir })
  const logger = { info() {}, error() {}, warn() {} }
  createThreadComponent({ host: host(), stateDirectory: join(agentDir, "state"), agentDir: () => agentDir, store })
    .register(pi as never, { logger, config: { getFlag: () => undefined } } as never)
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
const delivery = (sender: Record<string, unknown>) => ({
  message: {
    role: "custom", customType: "session_control_delivery",
    details: { delivery_id: "device:b/d-1", remote_origin: { deviceId: "b" }, sender },
  },
})

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
      await dispatch("message_start", delivery({ kind: "agent", session_id: "planner", name: "planner" }))
      expect(requests("planner")).toEqual(ASK)
    } finally {
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
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

  test("#given a run that replied to its sender #when the run settles #then a later send to that sender asks again", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-peer-reply-"))
    const { store, dispatch, requests } = component(agentDir)
    try {
      await dispatch("agent_start")
      await dispatch("message_start", delivery({ kind: "agent", session_id: SENDER, name: "A" }))
      expect(requests(SENDER)).toEqual(REPLY)
      await dispatch("agent_settled")
      expect(requests(SENDER)).toEqual(ASK)
    } finally {
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  test("#given a peer agent's delivery #when it is rendered #then it tells the receiver how a reply reaches the sender", () => {
    const envelope = { origin: { session: "sess-a" }, actor: "planner", via: ["sess-a"], root_id: "root-1", hop: 1, delivery_id: "d-1" }
    const row = {
      delivery_id: "d-1", target_durable_id: "receiver", seq: 1, sender: "session:sess-a", sender_turn: null, envelope,
      body: "What is your hostname?", bytes: 22, mode_requested: "auto", mode_effective: null, expected_turn_id: null,
      state: "queued", reason: null, admitted_by: null, claimed_at: null, attempt: 0, admission_kind: null, turn_epoch: null,
      root_id: "root-1", hop: 1, created_at: 1, updated_at: 1, expires_at: 2, binding_id: null, binding_revision: null,
      actor_user_id: null,
    } satisfies DeliveryRow
    const [, sentence = ""] = renderDeliveryText(row).split("\n")
    expect(sentence).toContain(GATEWAY_PEER_REPLY_SENTENCE)
    expect(GATEWAY_PEER_REPLY_SENTENCE).toContain("thread_send")
    expect(GATEWAY_PEER_REPLY_SENTENCE).toContain("sender_session")
  })
})
