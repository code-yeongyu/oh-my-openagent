import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCredentials, type ConnectorSurface } from "../../connector/credentials"
import { loadSlackSecrets } from "./connect"
import { FAKE_BOT_TOKEN, FAKE_COOKIE, FAKE_TEAM, FAKE_USER_TOKEN } from "./testing/fake-state"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-gateway-slack-connect-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function secretsFor(surface: ConnectorSurface, env: Record<string, string> = {}) {
  const credentials = await resolveCredentials(surface, { env, home: dir })
  return loadSlackSecrets({ scope: "qa", surface, credentials, agentDir: dir, log: () => undefined })
}

test("an agent-messenger store directory yields the configured workspace's token and cookie", async () => {
  const store = join(dir, "store")
  mkdirSync(store, { mode: 0o700 })
  const file = join(store, "slack-credentials.json")
  writeFileSync(file, JSON.stringify({ current_workspace: "T000OTHER", workspaces: { [FAKE_TEAM]: { token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE, workspace_id: FAKE_TEAM } } }))
  chmodSync(file, 0o600)
  expect(await secretsFor({ platform: "slack", account_id: FAKE_TEAM, credentials_dir: store })).toEqual({ token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE })
})

test("a credentials file or env var holds a flat app profile; a missing workspace is refused without echoing secrets", async () => {
  const file = join(dir, "slack.json")
  writeFileSync(file, JSON.stringify({ bot_token: FAKE_BOT_TOKEN, app_token: "xapp-fake-app-0000" }), { mode: 0o600 })
  expect(await secretsFor({ platform: "slack", account_id: FAKE_TEAM, credentials_file: file, token_kind: "bot" })).toEqual({ token: FAKE_BOT_TOKEN, app_token: "xapp-fake-app-0000" })
  const env = { SLACK_QA: JSON.stringify({ workspaces: { T000OTHER: { token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE } } }) }
  const refused = await secretsFor({ platform: "slack", account_id: FAKE_TEAM, credentials_env: "SLACK_QA" }, env).catch((error: unknown) => error)
  expect(refused instanceof Error ? refused.message : "").toBe(`slack credentials in env SLACK_QA have no workspace ${FAKE_TEAM}`)
  expect(String(refused)).not.toContain(FAKE_USER_TOKEN)
})
