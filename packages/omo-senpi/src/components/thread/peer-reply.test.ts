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
type PermissionRequest = { readonly permission: string; readonly patterns: readonly string[]; readonly always: readonly string[] }
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
const delivery = (sender: Record<string, unknown>) => ({
  message: {
    role: "custom", customType: "session_control_delivery",
    details: { delivery_id: "device:b/d-1", remote_origin: { deviceId: "b" }, sender },
  },
})

describe("#12886 a peer-delivered run replies to its sender", () => {
  test("#given a run woken by an agent's delivery #when it sends back to that agent's session #then no permission is asked, and any other target still asks", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "thr-peer-reply-"))
    const { store, dispatch, requests } = component(agentDir)
    try {
      expect(requests("sess-a")).toEqual(ASK)
      await dispatch("agent_start")
      await dispatch("message_start", delivery({ kind: "agent", session_id: "sess-a", name: "A" }))
      expect(requests("sess-a")).toEqual([])
      expect(requests("sess-other")).toEqual(ASK)
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
      expect(requests("sess-a")).toEqual(ASK)
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
