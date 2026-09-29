import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SurfaceKey } from "../adapter/contract"
import { startFakeTelegramServer, type FakeTelegramServer } from "../adapters/telegram/fake-server"
import { FAKE_BOT, FAKE_DM } from "../adapters/telegram/fake-telegram"
import { runConnectCommand, type ConnectContext } from "./cli"
import { connectorsDir } from "./lock"

const ACCOUNT = String(FAKE_BOT.id)
const dm: SurfaceKey = { platform: "telegram", account_id: ACCOUNT, chat_id: String(FAKE_DM.id), thread_id: null }

const roots: string[] = []
const servers: FakeTelegramServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Captured = { out: string[]; err: string[] }

function writer(lines: string[]) {
  return {
    write(chunk: string, callback?: (error?: Error | null) => void): boolean {
      lines.push(...chunk.split("\n").filter((line) => line !== ""))
      callback?.()
      return true
    },
  }
}

function rig(surface: Record<string, unknown>, credentials: string): { ctx: ConnectContext; captured: Captured } {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-builtin-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(connectorsDir(agentDir), { recursive: true, mode: 0o700 })
  const creds = join(root, "creds.json")
  writeFileSync(creds, credentials, { mode: 0o600 })
  const captured: Captured = { out: [], err: [] }
  const ctx: ConnectContext = {
    gateway: { scopes: [{ id: "qa", surfaces: [{ ...surface, credentials_file: creds }] }] },
    agentDir,
    env: {},
    home: root,
    stdout: writer(captured.out),
    stderr: writer(captured.err),
    launch: [],
    signals: { on: () => undefined, off: () => undefined },
  }
  return { ctx, captured }
}

describe("omo gateway connect with a built-in adapter", () => {
  test("#given a telegram surface and no --adapter-module #when connect --once runs #then the built-in adapter delivers the pending message", async () => {
    // given
    const server = startFakeTelegramServer()
    servers.push(server)
    server.fake.humanPost({ key: dm, text: "hello from the built-in path" })
    const { ctx, captured } = rig({ platform: "telegram", account_id: ACCOUNT }, JSON.stringify({ token: server.token, api_base: server.url }))

    // when
    const exit = await runConnectCommand(["--scope", "qa", "--surface", "telegram", "--once", "--sink", "stdout"], ctx)

    // then
    expect(exit).toBe(0)
    const events = captured.out.filter((line) => line.startsWith("GATEWAY_EVENT ")).map((line) => JSON.parse(line.slice("GATEWAY_EVENT ".length)).event.text)
    expect(events).toEqual(["hello from the built-in path"])
  })

  test("#given a rejected bot token #when connect --once runs #then it prints one owner notice, exits 1 and never echoes the token", async () => {
    // given
    const server = startFakeTelegramServer()
    servers.push(server)
    const wrong = `${FAKE_BOT.id}:WRONG-TOKEN`
    const { ctx, captured } = rig({ platform: "telegram", account_id: ACCOUNT }, JSON.stringify({ token: wrong, api_base: server.url }))

    // when
    const exit = await runConnectCommand(["--scope", "qa", "--once", "--sink", "stdout"], ctx)

    // then
    expect(exit).toBe(1)
    const notices = captured.err.filter((line) => line.startsWith("NOTICE "))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("(401)")
    expect(captured.err.join("\n")).not.toContain("WRONG-TOKEN")
  })

  test("#given a platform without a built-in adapter #when connect runs without --adapter-module #then it exits 2 naming the platform", async () => {
    // given
    const { ctx, captured } = rig({ platform: "notion", account_id: "notion-workspace-1" }, '{"token":"dummy"}')

    // when
    const exit = await runConnectCommand(["--scope", "qa", "--sink", "stdout"], ctx)

    // then
    expect(exit).toBe(2)
    expect(captured.err).toEqual(["omo gateway connect: no built-in notion adapter yet; pass --adapter-module <file>"])
  })
})
