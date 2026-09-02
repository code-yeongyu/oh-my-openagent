import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { assessClaudeSdkOauthLane } from "../bin/lib/claude-oauth-lane.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

const FAR_FUTURE_EXPIRES = 4102444800000
const NOW = 1756000000000

function freshSlot(name = "default"): Record<string, unknown> {
  return { name, access: "access-token", refresh: "refresh-token", expires: NOW + 3_600_000, source: "login" }
}

function credential(accounts: Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: "oauth",
    access: "claude-sdk-oauth-managed",
    refresh: "claude-sdk-oauth-managed",
    expires: FAR_FUTURE_EXPIRES,
    accounts,
  }
}

function createAgentDir(authJson?: string): string {
  const root = mkdtempSync(join(tmpdir(), "omo-claude-lane-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  if (authJson !== undefined) writeFileSync(join(agentDir, "auth.json"), authJson)
  return agentDir
}

function assess(agentDir: string, env: NodeJS.ProcessEnv = {}): ReturnType<typeof assessClaudeSdkOauthLane> {
  return assessClaudeSdkOauthLane({ agentDir, env, now: NOW })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("assessClaudeSdkOauthLane", () => {
  describe("#given no claude-sdk-oauth credential and no env tokens", () => {
    test("#then the lane is not the user's concern and nothing is emitted", () => {
      const agentDir = createAgentDir(undefined)
      expect(assess(agentDir)).toBeUndefined()
    })

    test("#then an unrelated auth.json provider stays silent", () => {
      const agentDir = createAgentDir(JSON.stringify({ anthropic: { type: "api", key: "sk" } }))
      expect(assess(agentDir)).toBeUndefined()
    })
  })

  describe("#given a saved login with one fresh unblocked slot", () => {
    test("#then the lane passes and reports the available slot", () => {
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([freshSlot()]) }))
      const result = assess(agentDir)
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual(["PASS claude sdk oauth lane: 1 account slot(s) available"])
    })
  })

  describe("#given a saved login whose every slot is blocked with auth_error", () => {
    test("#then the lane fails and points at re-login", () => {
      const blocked = { ...freshSlot(), blockReason: "auth_error" }
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([blocked]) }))
      const result = assess(agentDir)
      expect(result?.failed).toBe(true)
      expect(result?.lines[0]).toContain("FAIL claude sdk oauth lane")
      expect(result?.lines[0]).toContain("all 1 account slot(s) are blocked or expired")
      expect(result?.lines[0]).toContain("/login claude-sdk-oauth")
    })
  })

  describe("#given a saved login whose every slot is expired", () => {
    test("#then the lane fails instead of trusting a stale token", () => {
      const expired = { ...freshSlot(), expires: NOW - 1_000 }
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([expired]) }))
      const result = assess(agentDir)
      expect(result?.failed).toBe(true)
      expect(result?.lines[0]).toContain("all 1 account slot(s) are blocked or expired")
    })
  })

  describe("#given a mix of usable and unusable slots", () => {
    test("#then the lane passes and discloses the unusable count", () => {
      const blocked = { ...freshSlot("account-2"), blockReason: "auth_error" }
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([freshSlot(), blocked]) }))
      const result = assess(agentDir)
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual([
        "PASS claude sdk oauth lane: 1 account slot(s) available (1 blocked or expired)",
      ])
    })
  })

  describe("#given a saved login record with zero account slots", () => {
    test("#then the lane fails because background calls fall back to the CLI's own login", () => {
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([]) }))
      const result = assess(agentDir)
      expect(result?.failed).toBe(true)
      expect(result?.lines[0]).toContain("no account slots")
      expect(result?.lines[0]).toContain("/login claude-sdk-oauth")
    })
  })

  describe("#given only a CLAUDE_CODE_OAUTH_TOKEN env token", () => {
    test("#then the env token counts as an available slot", () => {
      const agentDir = createAgentDir(undefined)
      const result = assess(agentDir, { CLAUDE_CODE_OAUTH_TOKEN: "env-token" })
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual(["PASS claude sdk oauth lane: 1 account slot(s) available"])
    })
  })

  describe("#given SENPI_CLAUDE_SDK_OAUTH_ENABLED disables the provider", () => {
    test("#then the lane reports disabled without failing", () => {
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([]) }))
      const result = assess(agentDir, { SENPI_CLAUDE_SDK_OAUTH_ENABLED: "0" })
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual(["PASS claude sdk oauth lane: disabled by configuration"])
    })
  })

  describe("#given settings.json pins tokenInjection ambient", () => {
    test("#then the lane respects the explicit ambient choice", () => {
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([freshSlot()]) }))
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({ claudeSdkOauthProvider: { tokenInjection: "ambient" } }),
      )
      const result = assess(agentDir)
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual(["PASS claude sdk oauth lane: ambient (the Claude CLI manages its own login)"])
    })
  })

  describe("#given the env token-injection override wins over settings", () => {
    test("#then slots are evaluated even when settings say ambient", () => {
      const agentDir = createAgentDir(JSON.stringify({ "claude-sdk-oauth": credential([freshSlot()]) }))
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({ claudeSdkOauthProvider: { tokenInjection: "ambient" } }),
      )
      const result = assess(agentDir, { SENPI_CLAUDE_SDK_OAUTH_TOKEN_INJECTION: "oauth-slots" })
      expect(result?.failed).toBe(false)
      expect(result?.lines).toEqual(["PASS claude sdk oauth lane: 1 account slot(s) available"])
    })
  })

  describe("#given auth.json is corrupt", () => {
    test("#then diagnostics warn about the unreadable store without failing the run", () => {
      const agentDir = createAgentDir("{ not-json\n")
      const result = assess(agentDir)
      expect(result?.failed).toBe(false)
      expect(result?.lines[0]).toContain("WARN could not parse")
      expect(result?.lines[0]).toContain("auth.json")
    })
  })
})

type Fixture = { root: string; packageRoot: string; launcher: string; agentDir: string }

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-claude-lane-e2e-"))
  roots.push(root)
  const packageRoot = join(root, "app")
  mkdirSync(packageRoot, { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  const writeFile = (path: string, content = "fixture\n"): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "1.2.3-test.0",
    type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.9",
    type: "module",
    exports: { ".": "./dist/index.js" },
  }))
  writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(senpiRoot, "dist", "cli.js"), "process.exit(0)\n")
  for (const artifact of [
    "plugin/package.json",
    "plugin/extensions/omo.js",
    "plugin/runtime/lsp-daemon/dist/cli.js",
    "plugin/runtime/agent-toolkit/cli.js",
  ]) writeFile(join(packageRoot, artifact))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  return { root, packageRoot, launcher: join(packageRoot, "bin", "omo.js"), agentDir }
}

function runDoctor(fixture: Fixture, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [fixture.launcher, "doctor"], {
    encoding: "utf8",
    env: { ...process.env, SENPI_CODING_AGENT_DIR: fixture.agentDir, ...env },
  })
}

describe("omo doctor claude sdk oauth lane wiring", () => {
  describe("#given an install whose saved claude-sdk-oauth login has no usable slots", () => {
    test("#then doctor fails with the actionable lane line", () => {
      const fixture = createFixture()
      writeFileSync(
        join(fixture.agentDir, "auth.json"),
        JSON.stringify({ "claude-sdk-oauth": credential([{ ...freshSlot(), blockReason: "auth_error" }]) }),
      )
      const result = runDoctor(fixture)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain("FAIL claude sdk oauth lane")
      expect(result.stdout).toContain("/login claude-sdk-oauth")
    })
  })

  describe("#given an install that never used claude-sdk-oauth", () => {
    test("#then doctor output stays free of lane noise", () => {
      const fixture = createFixture()
      const result = runDoctor(fixture)
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain("claude sdk oauth lane")
    })
  })
})
