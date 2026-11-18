import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadComponent } from "./component"
import { createGatewayStore } from "./gateway/store"
import type { ThreadHost } from "./tools"

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

const LOCAL_ID = "0195f0c2-1a2b-7c3d-8e4f-a1b2c3d4e5f6"
const REMOTE_ID = "0195f0c2-1a2b-7c3d-8e4f-0f0e0d0c0b0a"
const LOCAL_NAME = "local-helper"
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function host(): ThreadHost {
  const unused = async (): Promise<never> => {
    throw new Error("unused host operation")
  }
  return {
    socket: "/tmp/thread-local-permission.sock",
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

function threadTools(): ReadonlyMap<string, CapturedTool> {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-local-permission-"))
  dirs.push(agentDir)
  const sessionDir = join(agentDir, "sessions", "--tmp-workspace--")
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(
    join(sessionDir, `2026-11-17T00-00-00-000Z_${LOCAL_ID}.jsonl`),
    `${JSON.stringify({ type: "session", id: LOCAL_ID, cwd: "/tmp/workspace", timestamp: "2026-11-17T00:00:00.000Z" })}\n${JSON.stringify({ type: "session_info", name: LOCAL_NAME })}\n`,
  )
  const tools = new Map<string, CapturedTool>()
  const pi = {
    cwd: process.cwd(),
    registerTool(tool: CapturedTool) {
      tools.set(tool.name, tool)
    },
    on() {},
    registerCommand() {},
    registerFlag() {},
    getFlag() {
      return undefined
    },
    sendMessage() {},
    sendUserMessage() {},
  }
  createThreadComponent({
    host: host(),
    stateDirectory: join(agentDir, "state"),
    agentDir: () => agentDir,
    store: createGatewayStore({ agentDir }),
  }).register(
    pi as never,
    { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never,
  )
  return tools
}

function requests(tools: ReadonlyMap<string, CapturedTool>, name: string, input: Record<string, unknown>) {
  const parse = tools.get(name)?.permissionParser
  if (parse === undefined) throw new Error(`${name} declares no permission parser`)
  return parse(input, process.cwd())
}

const LOCAL_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["thread_list", { all_scope: true }],
  ["thread_read", { thread: LOCAL_ID }],
  ["thread_create", { name: "helper", prompt: "hi" }],
  ["thread_create", { fork_from: LOCAL_ID }],
  ["thread_create", { thread: LOCAL_ID }],
  ["thread_read", { thread: REMOTE_ID }],
  ["thread_send", { thread: LOCAL_ID, message: "hi" }],
  ["thread_handoff", { thread: LOCAL_ID, message: "hi" }],
  ["thread_interrupt", { thread: LOCAL_ID }],
  ["thread_close", { thread: LOCAL_ID }],
  ["thread_close", {}],
  ["thread_rename", { name: "renamed" }],
  ["thread_set_model", { thread: LOCAL_ID, model: "a/b" }],
  ["thread_set_reasoning", { thread: LOCAL_ID, level: "high" }],
  ["thread_report", { kind: "progress", text: "x" }],
  ["thread_outbox", {}],
  ["thread_outbox_ack", { binding_id: "b", cursor: 1 }],
  ["thread_answer", { binding_id: "b", reply_token: "t", answer: "yes" }],
]

describe("i22: routine local thread tool calls ask for no approval", () => {
  test.each(LOCAL_CALLS)(
    "#given a call of %s that stays on this device #when its permission is parsed #then the ask is auto-approved",
    (name, input) => {
      const parsed = requests(threadTools(), name, input)
      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.permission).toBe(name)
      expect(parsed[0]?.autoApproveAsk).toBe(true)
    },
  )

  test("#given calls that name another device, a session this device does not hold, a target by name (an account alias resolves before a name), or an account-wide alias claim #when parsed #then each still asks", () => {
    const tools = threadTools()
    const asks = [
      requests(tools, "thread_create", { device: "other-device", name: "x" }),
      requests(tools, "thread_create", { thread: REMOTE_ID }),
      requests(tools, "thread_create", { fork_from: REMOTE_ID }),
      requests(tools, "thread_create", { name: "x", alias: "shared-alias" }),
      requests(tools, "thread_rename", { thread: LOCAL_ID, alias: "shared-alias" }),
      requests(tools, "thread_send", { thread: LOCAL_NAME, message: "hi" }),
      requests(tools, "thread_close", { thread: LOCAL_NAME, all_scope: true }),
      requests(tools, "thread_send", { thread: REMOTE_ID, message: "hi" }),
      requests(tools, "thread_send", { thread: "an-account-alias", message: "hi" }),
      requests(tools, "thread_handoff", { thread: "near name", match: "fuzzy", message: "hi" }),
      requests(tools, "thread_close", { thread: REMOTE_ID }),
    ]
    for (const parsed of asks) expect(parsed.some((request) => request.autoApproveAsk === true)).toBe(false)
  })
})
