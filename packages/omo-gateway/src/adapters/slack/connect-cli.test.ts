import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runConnectCommand, type ConnectContext } from "../../connector/cli"
import { connectorsDir } from "../../connector/lock"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_CHAT, FAKE_COOKIE, FAKE_TEAM, FAKE_USER_TOKEN } from "./testing/fake-state"

let server: FakeSlackServer
let root: string

beforeEach(() => {
  server = new FakeSlackServer()
  root = mkdtempSync(join(tmpdir(), "omo-gateway-slack-connect-cli-"))
})

afterEach(() => {
  server.stop()
  rmSync(root, { recursive: true, force: true })
})

function writer(lines: string[]) {
  return {
    write(chunk: string, callback?: (error?: Error | null) => void): boolean {
      lines.push(...chunk.split("\n").filter((line) => line !== ""))
      callback?.()
      return true
    },
  }
}

function context(out: string[], err: string[]): ConnectContext {
  const agentDir = join(root, "agent")
  mkdirSync(connectorsDir(agentDir), { recursive: true, mode: 0o700 })
  const creds = join(root, "slack.json")
  writeFileSync(creds, JSON.stringify({ token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE, api_base: server.apiBase }), { mode: 0o600 })
  return {
    gateway: { scopes: [{ id: "qa", surfaces: [{ platform: "slack", account_id: FAKE_TEAM, credentials_file: creds, listen: { owned_chats: [FAKE_CHAT] } }] }] },
    agentDir,
    env: {},
    home: root,
    stdout: writer(out),
    stderr: writer(err),
    launch: [],
    signals: { on: () => undefined, off: () => undefined },
  }
}

describe("omo gateway connect --surface slack (built-in adapter)", () => {
  test("#given no --adapter-module #when connect --once runs against the fake Slack #then the built-in adapter prints the waiting messages", async () => {
    // given
    server.humanPost({ channel: FAKE_CHAT, text: "first waiting message" })
    server.humanPost({ channel: FAKE_CHAT, text: "second waiting message" })
    const out: string[] = []
    const err: string[] = []

    // when
    const exit = await runConnectCommand(["--scope", "qa", "--surface", "slack", "--once", "--sink", "stdout"], context(out, err))

    // then
    expect(exit).toBe(0)
    const texts = out.filter((line) => line.startsWith("GATEWAY_EVENT ")).map((line) => JSON.parse(line.slice("GATEWAY_EVENT ".length)).event.text)
    expect(texts).toEqual(["first waiting message", "second waiting message"])
  })

  test("#given Slack answers invalid_auth #when connect --once runs #then one owner notice, exit 1, and no secret in the output", async () => {
    // given
    server.revoked.add(FAKE_USER_TOKEN)
    const out: string[] = []
    const err: string[] = []

    // when
    const exit = await runConnectCommand(["--scope", "qa", "--surface", "slack", "--once", "--sink", "stdout"], context(out, err))

    // then
    expect(exit).toBe(1)
    const notices = err.filter((line) => line.startsWith("NOTICE "))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("slack auth.test: invalid_auth")
    expect([...out, ...err].join("\n")).not.toContain(FAKE_USER_TOKEN)
    expect(server.callsOf("auth.test")).toHaveLength(1)
  })
})
