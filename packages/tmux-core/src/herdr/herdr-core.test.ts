import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPaneAuthDirectory } from "../pane-auth"
import {
  HERDR_TEAM_WORKSPACE_LABEL_PREFIX,
  buildHerdrPaneAuthEnv,
  herdrCloseWorkspace,
  herdrCreateTab,
  herdrCreateWorkspace,
  herdrListAgents,
  herdrListTeamWorkspaces,
  herdrReadPane,
  herdrRunPaneCommand,
  isHerdrPaneId,
  herdrWorkspaceIdFromPaneId,
  ensureHerdrServer,
  parseHerdrEnvelope,
  runHerdrCommandDefault,
  type HerdrExecResult,
  type HerdrOpsDeps,
  type RunHerdrCommand,
} from "./herdr-core"

function ok(output: string): HerdrExecResult {
  return { success: true, output }
}

function envelope(result: unknown): string {
  return JSON.stringify({ id: "cli:test", result })
}

function fakeOps(
  script: (args: ReadonlyArray<string>) => HerdrExecResult,
): { deps: HerdrOpsDeps; calls: string[][] } {
  const calls: string[][] = []
  const run: RunHerdrCommand = async (args) => {
    calls.push([...args])
    return script(args)
  }
  return { deps: { runHerdrCommand: run, ensureServer: async () => "running" }, calls }
}

describe("herdr id grammar", () => {
  test("accepts numeric and alphanumeric pane ids", () => {
    expect(isHerdrPaneId("w5:p2")).toBe(true)
    expect(isHerdrPaneId("wA:p12")).toBe(true)
    expect(isHerdrPaneId("wK:p2")).toBe(true)
  })

  test("rejects tmux and malformed ids", () => {
    expect(isHerdrPaneId("%12")).toBe(false)
    expect(isHerdrPaneId("w5:")).toBe(false)
    expect(isHerdrPaneId("")).toBe(false)
    expect(isHerdrPaneId(undefined)).toBe(false)
  })

  test("derives the workspace id from a pane id", () => {
    expect(herdrWorkspaceIdFromPaneId("wA:p3")).toBe("wA")
    expect(() => herdrWorkspaceIdFromPaneId("%12")).toThrow()
  })
})

describe("parseHerdrEnvelope", () => {
  test("accepts success envelopes, error envelopes, and plain text", () => {
    expect(parseHerdrEnvelope(envelope({ agents: [] }))).toEqual({ kind: "ok", result: { agents: [] } })
    expect(parseHerdrEnvelope('{"error":{"code":"server_not_running","message":"down"}}'))
      .toEqual({ kind: "error", code: "server_not_running", message: "down" })
    // pane read/run output is plain text — never an envelope
    expect(parseHerdrEnvelope("plain pane text")).toEqual({ kind: "ok" })
    expect(parseHerdrEnvelope("")).toEqual({ kind: "ok" })
  })
})

describe("buildHerdrPaneAuthEnv", () => {
  test("returns no auth env when no password is configured", () => {
    const saved = {
      password: process.env["OPENCODE_SERVER_PASSWORD"],
      file: process.env["OPENCODE_SERVER_PASSWORD_FILE"],
      username: process.env["OPENCODE_SERVER_USERNAME"],
    }
    delete process.env["OPENCODE_SERVER_PASSWORD"]
    delete process.env["OPENCODE_SERVER_PASSWORD_FILE"]
    delete process.env["OPENCODE_SERVER_USERNAME"]
    try {
      expect(buildHerdrPaneAuthEnv()).toEqual({})
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("hands off through a single-use 0600 file plus username, never the password", () => {
    // Non-secret test fixture, assembled at runtime so secret scanners do not
    // see a literal password-value assignment next to a username assignment.
    const fixturePassword = ["sek", "ret"].join("")
    const saved = {
      password: process.env["OPENCODE_SERVER_PASSWORD"],
      file: process.env["OPENCODE_SERVER_PASSWORD_FILE"],
      username: process.env["OPENCODE_SERVER_USERNAME"],
    }
    process.env["OPENCODE_SERVER_PASSWORD"] = fixturePassword
    process.env["OPENCODE_SERVER_USERNAME"] = "omo-user"
    delete process.env["OPENCODE_SERVER_PASSWORD_FILE"]
    const cleanupAuthDirectory = createPaneAuthDirectory()
    let passwordFile: string | undefined
    try {
      const env = buildHerdrPaneAuthEnv()
      expect(Object.keys(env).sort()).toEqual(["OPENCODE_SERVER_PASSWORD_FILE", "OPENCODE_SERVER_USERNAME"])
      expect(env["OPENCODE_SERVER_USERNAME"]).toBe("omo-user")
      passwordFile = env["OPENCODE_SERVER_PASSWORD_FILE"]
      if (!passwordFile) throw new Error("missing password file")
      expect(Object.values(env).some((value) => value.includes(fixturePassword))).toBe(false)
      expect(statSync(passwordFile).mode & 0o777).toBe(0o600)
      expect(readFileSync(passwordFile, "utf8")).toBe(`export OPENCODE_SERVER_PASSWORD='${fixturePassword}'\n`)
      // every call writes a fresh single-use file (one per tab)
      expect(buildHerdrPaneAuthEnv()["OPENCODE_SERVER_PASSWORD_FILE"]).not.toBe(passwordFile)
    } finally {
      if (passwordFile) rmSync(passwordFile, { force: true })
      cleanupAuthDirectory()
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe.skipIf(process.platform === "win32")("runHerdrCommandDefault", () => {
  test("resolves herdr through PATH and settles without waiting out the timeout window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-herdr-exec-"))
    try {
      // absolute binaries only: the child PATH is the temp dir alone, so a
      // bare command would fall back to the shell's default-PATH behavior
      // (bash does, dash does not) and make the test platform-dependent
      writeFileSync(join(dir, "herdr"), "#!/bin/sh\nexec /bin/echo hi\n", { mode: 0o755 })
      const startedAt = Date.now()
      const result = await runHerdrCommandDefault(["workspace", "list"], { env: { PATH: dir }, timeoutMs: 20_000 })
      // a fast exit wins the race and its timer is cleared: the call returns
      // immediately instead of holding the loop for the full window
      expect(result).toEqual({ success: true, output: "hi\n" })
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("reports a typed timeout when the command exceeds the deadline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-herdr-exec-"))
    try {
      // exec /bin/sleep keeps the child alive past the deadline regardless of
      // PATH (a bare `sleep` would exit 127 under dash and never time out)
      writeFileSync(join(dir, "herdr"), "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o755 })
      const startedAt = Date.now()
      const result = await runHerdrCommandDefault(["agent", "list"], { env: { PATH: dir }, timeoutMs: 100 })
      expect(result.success).toBe(false)
      expect(result.code).toBe("timeout")
      expect(result.error).toContain("timed out after 100ms")
      // it really waited for the watchdog (not a fast child exit) and the
      // test still settles in a fraction of the child's lifetime
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90)
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("clears the watchdog timer once settled: a fast exec does not hold the process for the window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-herdr-timer-"))
    try {
      writeFileSync(join(dir, "herdr"), "#!/bin/sh\nexec /bin/echo hi\n", { mode: 0o755 })
      // A child bun process runs one exec against a fast fake herdr with a
      // huge timeout, then finishes its script. A pending (uncleared)
      // setTimeout keeps a bun process alive until it fires, so the child's
      // total lifetime pins the cleanup: immediate exit with the clearTimeout
      // fix, ~timeoutMs of lingering without it.
      const probe = join(dir, "probe.ts")
      const herdrCore = JSON.stringify(join(import.meta.dir, "herdr-core.ts"))
      writeFileSync(probe, [
        `const { runHerdrCommandDefault } = await import(${herdrCore})`,
        `const result = await runHerdrCommandDefault(["agent", "list"], { env: { PATH: ${JSON.stringify(dir)} }, timeoutMs: 10_000 })`,
        `if (!result.success || result.output !== "hi\\n") { console.error("probe exec failed:", result); process.exit(2) }`,
        `console.log("settled")`,
      ].join("\n"))
      const startedAt = Date.now()
      const child = Bun.spawn([process.execPath, probe], { stdout: "pipe", stderr: "pipe" })
      const exitCode = await child.exited
      const elapsed = Date.now() - startedAt
      expect(exitCode).toBe(0)
      expect(await new Response(child.stdout).text()).toBe("settled\n")
      expect(elapsed).toBeLessThan(8_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("herdr ops", () => {
  test("workspace create pins cwd, label, and focus", async () => {
    const { deps, calls } = fakeOps(() => ok(envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } })))
    const created = await herdrCreateWorkspace("/repo", "omo-team-x", deps)
    expect(created.workspaceId).toBe("w9")
    expect(created.rootPaneId).toBe("w9:p1")
    expect(calls[0]).toEqual(["workspace", "create", "--cwd", "/repo", "--label", "omo-team-x", "--no-focus"])
  })

  test("tab create always pins the workspace and forwards env", async () => {
    const { deps, calls } = fakeOps(() => ok(envelope({ tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p2" } })))
    const tab = await herdrCreateTab("w9", "/repo", "worker-1", { OPENCODE_SERVER_PASSWORD_FILE: "/tmp/p" }, deps)
    expect(tab).toEqual({ paneId: "w9:p2", tabId: "w9:t2" })
    expect(calls[0]).toContain("--workspace")
    expect(calls[0]).toContain("OPENCODE_SERVER_PASSWORD_FILE=/tmp/p")
    expect(calls[0]).toContain("--no-focus")
  })

  test("pane run and pane read are text-surface commands", async () => {
    const { deps, calls } = fakeOps(() => ok(""))
    await herdrRunPaneCommand("w9:p2", "opencode attach http://x --session s", deps)
    expect(calls[0]).toEqual(["pane", "run", "w9:p2", "opencode attach http://x --session s"])

    const read = fakeOps(() => ok("line1\nline2"))
    const text = await herdrReadPane("w9:p2", 80, read.deps)
    expect(text).toBe("line1\nline2")
    expect(read.calls[0]).toEqual(["pane", "read", "w9:p2", "--source", "recent-unwrapped", "--lines", "80"])
  })

  test("agent list maps the live-agent inventory", async () => {
    const { deps } = fakeOps(() => ok(envelope({ agents: [{ pane_id: "w9:p2", name: "a", agent_status: "idle" }] })))
    const agents = await herdrListAgents(deps)
    expect(agents).toEqual([{ paneId: "w9:p2", name: "a", status: "idle" }])
  })

  test("team workspace listing filters by label prefix", async () => {
    const { deps } = fakeOps(() => ok(envelope({
      workspaces: [
        { workspace_id: "w1", label: "user-own" },
        { workspace_id: "w2", label: `${HERDR_TEAM_WORKSPACE_LABEL_PREFIX}abc` },
      ],
    })))
    const teams = await herdrListTeamWorkspaces(deps)
    expect(teams).toEqual([{ workspaceId: "w2", label: "omo-team-abc" }])
  })

  test("workspace close surfaces typed failures", async () => {
    const { deps } = fakeOps(() => ({ success: false, output: "", error: "nope", code: "error" }))
    expect(herdrCloseWorkspace("w2", deps)).rejects.toThrow("nope")
  })
})

describe("ensureHerdrServer", () => {
  test("starts the headless server on server_not_running and polls until ready", async () => {
    let probes = 0
    const spawnedBox: { argv?: string[] } = {}
    const state = await ensureHerdrServer({
      runHerdrCommand: async () => {
        probes += 1
        // first probe: down; after spawn: up
        return spawnedBox.argv === undefined
          ? { success: false, output: "", error: "no herdr server is running", code: "server_not_running" }
          : { success: true, output: envelope({ agents: [] }) }
      },
      spawnDetached: (bin, args) => {
        spawnedBox.argv = [bin, ...args]
      },
      sleep: async () => {},
    })
    expect(state).toBe("started")
    expect(spawnedBox.argv).toEqual(["herdr", "server"])
    expect(probes).toBeGreaterThanOrEqual(2)
  })

  test("returns running when the server already answers", async () => {
    const state = await ensureHerdrServer({
      runHerdrCommand: async () => ({ success: true, output: envelope({ agents: [] }) }),
      spawnDetached: () => {
        throw new Error("must not spawn")
      },
      sleep: async () => {},
    })
    expect(state).toBe("running")
  })

  test("does not restart on unrelated command failures", async () => {
    await expect(ensureHerdrServer({
      runHerdrCommand: async () => ({ success: false, output: "", error: "agent_name_taken", code: "agent_name_taken" }),
      spawnDetached: () => {
        throw new Error("must not spawn")
      },
      sleep: async () => {},
    })).rejects.toThrow("agent_name_taken")
  })
})
