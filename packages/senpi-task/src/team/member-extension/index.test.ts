import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { TeamModeConfigSchema } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import registerMemberExtension from "./index"

const TEAM_RUN_ID = "77777777-7777-4777-8777-777777777777"
const MESSAGE_ID = "88888888-8888-4888-8888-888888888888"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member extension lifecycle", () => {
  test("#given unread mail during extension loading #when session_start fires #then runtime actions wait for the lifecycle edge", async () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-member-extension-"))
    roots.push(root)
    const stateDir = join(root, "state")
    const sessionDir = join(root, "sessions")
    const config = TeamModeConfigSchema.parse({ base_dir: join(stateDir, "teams") })
    mkdirSync(sessionDir, { recursive: true })
    await sendMessage({
      version: 1,
      messageId: MESSAGE_ID,
      from: "lead",
      to: "alice",
      kind: "message",
      body: "start only after bind",
      timestamp: 1,
    }, TEAM_RUN_ID, config, { isLead: true, activeMembers: ["alice"] })

    const handlers = new Map<string, Array<() => unknown | Promise<unknown>>>()
    const toolNames: string[] = []
    const injected: string[] = []
    let reportInjection = (): void => undefined
    const injection = new Promise<void>((resolve) => { reportInjection = resolve })
    let loading = true
    const api = {
      on(event: string, handler: () => unknown | Promise<unknown>) {
        const registered = handlers.get(event) ?? []
        registered.push(handler)
        handlers.set(event, registered)
      },
      registerTool(tool: { name: string }) {
        toolNames.push(tool.name)
      },
      sendUserMessage(content: string) {
        if (loading) throw new Error("runtime action called during extension loading")
        injected.push(content)
        reportInjection()
      },
    } as unknown as ExtensionAPI
    const previous = captureMemberEnv()
    Object.assign(process.env, {
      SENPI_TASK_MEMBER: `${TEAM_RUN_ID}::alice`,
      SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
      SENPI_TASK_TEAM_CONFIG: JSON.stringify({
        ...config,
        stateDir,
        members: ["alice"],
        wait: { min_ms: 5, default_ms: 50, max_ms: 100 },
      }),
      SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    })

    try {
      await registerMemberExtension(api)
      expect(injected).toEqual([])
      expect(toolNames).toEqual(["task_send", "team_wait"])

      loading = false
      await dispatch(handlers, "session_start")
      await withTimeout(injection, 5_000)

      expect(injected).toHaveLength(1)
      expect(injected[0]).toContain(MESSAGE_ID)
    } finally {
      await dispatch(handlers, "session_shutdown")
      restoreMemberEnv(previous)
    }
  })
})

const MEMBER_ENV_NAMES = [
  "SENPI_TASK_MEMBER",
  "SENPI_TASK_MEMBER_TASK_ID",
  "SENPI_TASK_TEAM_CONFIG",
  "SENPI_CODING_AGENT_SESSION_DIR",
] as const

type MemberEnvName = typeof MEMBER_ENV_NAMES[number]
type MemberEnvSnapshot = Readonly<Partial<Record<MemberEnvName, string>>>

function captureMemberEnv(): MemberEnvSnapshot {
  return Object.fromEntries(
    MEMBER_ENV_NAMES.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]),
  )
}

function restoreMemberEnv(snapshot: MemberEnvSnapshot): void {
  for (const name of MEMBER_ENV_NAMES) {
    const value = snapshot[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

async function dispatch(
  handlers: ReadonlyMap<string, readonly (() => unknown | Promise<unknown>)[]>,
  event: string,
): Promise<void> {
  for (const handler of handlers.get(event) ?? []) await handler()
}

async function withTimeout(completion: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("member poll interval did not inject unread mail")), timeoutMs)
  })
  try {
    await Promise.race([completion, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
