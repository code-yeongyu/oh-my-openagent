import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { buildTmuxAttachCommand } from "../tmux-utils/pane-command"
import { createPaneAuthDirectory } from "../pane-auth"
import {
  herdrClosePaneIfExists,
  herdrListWorkspacesByLabelPrefix,
  isHerdrBinaryCallable,
  type HerdrExecResult,
  type HerdrOpsDeps,
  type RunHerdrCommand,
} from "./herdr-core"
import {
  getHerdrAgentsWorkspaceLabel,
  spawnHerdrSubagentTab,
  sweepStaleHerdrAgentsWorkspacesWith,
} from "./herdr-subagent"

function ok(output: string): HerdrExecResult {
  return { success: true, output }
}

function envelope(result: unknown): string {
  return JSON.stringify({ id: "cli:test", result })
}

function errorEnvelope(code: string, message: string): HerdrExecResult {
  return { success: false, output: JSON.stringify({ id: "cli:test", error: { code, message } }), error: message, code }
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

const spawnArgs = {
  sessionId: "sess-1",
  description: "research worker",
  cwd: "/repo",
  serverUrl: "http://127.0.0.1:4096",
  workspaceLabel: "omo-agents-4242",
}

describe("getHerdrAgentsWorkspaceLabel", () => {
  test("mirrors the tmux isolated session grammar", () => {
    expect(getHerdrAgentsWorkspaceLabel(4242)).toBe("omo-agents-4242")
    expect(getHerdrAgentsWorkspaceLabel(4242, "7")).toBe("omo-agents-4242-7")
  })
})

describe("spawnHerdrSubagentTab", () => {
  test("creates the workspace on first spawn, pins it on the tab, and delivers the attach command via pane run", async () => {
    const authPassword = process.env["OPENCODE_SERVER_PASSWORD"]
    const authPasswordFile = process.env["OPENCODE_SERVER_PASSWORD_FILE"]
    const authUsername = process.env["OPENCODE_SERVER_USERNAME"]
    process.env["OPENCODE_SERVER_PASSWORD"] = "sekret"
    delete process.env["OPENCODE_SERVER_PASSWORD_FILE"]
    delete process.env["OPENCODE_SERVER_USERNAME"]
    const cleanupAuthDirectory = createPaneAuthDirectory()
    let passwordFile: string | undefined
    try {
      const { deps, calls } = fakeOps((args) => {
        if (args[0] === "workspace" && args[1] === "list") {
          return ok(envelope({ workspaces: [{ workspace_id: "w1", label: "wb-user" }] }))
        }
        if (args[0] === "workspace" && args[1] === "create") {
          return ok(envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }))
        }
        if (args[0] === "tab" && args[1] === "create") {
          return ok(envelope({ tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p2" } }))
        }
        return ok("")
      })

      const result = await spawnHerdrSubagentTab(spawnArgs, deps)

      expect(result.success).toBe(true)
      expect(result.paneId).toBe("w9:p2")
      expect(result.workspaceId).toBe("w9")

      const commands = calls.map((call) => `${call[0]} ${call[1] ?? ""}`.trim())
      // discovery finds no omo-agents workspace, so it creates one
      expect(commands).toEqual([
        "workspace list",
        "workspace create",
        "tab create",
        "pane run",
      ])
      const create = calls[1]
      expect(create).toEqual(["workspace", "create", "--cwd", "/repo", "--label", "omo-agents-4242", "--no-focus"])
      const tab = calls[2]
      expect(tab.slice(0, 9)).toEqual([
        "tab", "create", "--workspace", "w9", "--cwd", "/repo", "--label", "research worker", "--env",
      ])
      // password auth travels as a single-use 0600 file path, never as the
      // password itself (--env argv is world-readable in the process list)
      expect(tab.some((arg) => arg.includes("sekret"))).toBe(false)
      const fileArg = tab.find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))
      expect(fileArg).toBeDefined()
      passwordFile = fileArg?.slice("OPENCODE_SERVER_PASSWORD_FILE=".length)
      expect(passwordFile).toBeDefined()
      if (!passwordFile) throw new Error("missing password file arg")
      expect(statSync(passwordFile).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(passwordFile)).mode & 0o777).toBe(0o700)
      expect(readFileSync(passwordFile, "utf8")).toBe("export OPENCODE_SERVER_PASSWORD='sekret'\n")
      expect(tab.at(-1)).toBe("--no-focus")
      // the pane run payload is exactly the attach string activateTmuxPane
      // uses, and it sources the same file before attaching
      expect(calls[3]).toEqual([
        "pane", "run", "w9:p2",
        buildTmuxAttachCommand("http://127.0.0.1:4096", "sess-1", "/repo"),
      ])
      expect(calls[3][3]).toContain("opencode attach")
      expect(calls[3][3]).toContain("OPENCODE_SERVER_PASSWORD_FILE")
    } finally {
      cleanupAuthDirectory()
      if (passwordFile) rmSync(passwordFile, { force: true })
      if (authPassword === undefined) delete process.env["OPENCODE_SERVER_PASSWORD"]
      else process.env["OPENCODE_SERVER_PASSWORD"] = authPassword
      if (authPasswordFile === undefined) delete process.env["OPENCODE_SERVER_PASSWORD_FILE"]
      else process.env["OPENCODE_SERVER_PASSWORD_FILE"] = authPasswordFile
      if (authUsername === undefined) delete process.env["OPENCODE_SERVER_USERNAME"]
      else process.env["OPENCODE_SERVER_USERNAME"] = authUsername
    }
  })

  test.skipIf(process.platform === "win32")("a pane shell consumes the handoff: password arrives via the 0600 file and the file is unlinked before attach", async () => {
    const authPassword = process.env["OPENCODE_SERVER_PASSWORD"]
    process.env["OPENCODE_SERVER_PASSWORD"] = "sekret"
    const cleanupAuthDirectory = createPaneAuthDirectory()
    const sandbox = mkdtempSync(join(tmpdir(), "omo-herdr-auth-"))
    let passwordFile: string | undefined
    try {
      const { deps, calls } = fakeOps((args) => {
        if (args[0] === "workspace" && args[1] === "list") return ok(envelope({ workspaces: [] }))
        if (args[0] === "workspace" && args[1] === "create") {
          return ok(envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }))
        }
        if (args[0] === "tab" && args[1] === "create") {
          return ok(envelope({ tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p2" } }))
        }
        return ok("")
      })

      const result = await spawnHerdrSubagentTab(spawnArgs, deps)
      expect(result.success).toBe(true)
      const tab = calls.find((call) => call[0] === "tab" && call[1] === "create")
      const fileArg = tab?.find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))
      passwordFile = fileArg?.slice("OPENCODE_SERVER_PASSWORD_FILE=".length)
      if (!passwordFile) throw new Error("missing password file arg")
      const paneRunCommand = calls.find((call) => call[0] === "pane" && call[1] === "run")?.[3]
      if (!paneRunCommand) throw new Error("missing pane run command")

      // a fake `opencode` proves the pane shell sees the password in its
      // environment (not in argv) and that the one-use file is already gone
      writeFileSync(join(sandbox, "opencode"), [
        "#!/bin/sh",
        'test "$OPENCODE_SERVER_PASSWORD" = "sekret" || exit 2',
        'test ! -e "$OPENCODE_SERVER_PASSWORD_FILE" || exit 3',
        'for arg in "$@"; do test "$arg" != "sekret" || exit 4; done',
        "printf auth-ok",
      ].join("\n"), { mode: 0o700 })

      // simulate the pane shell: the --env vars are exported, the pane run
      // payload is the command line the shell executes
      const child = Bun.spawn(["/bin/sh", "-c", paneRunCommand], {
        env: {
          ...process.env,
          PATH: `${sandbox}:${process.env.PATH ?? ""}`,
          OPENCODE_SERVER_PASSWORD: "",
          OPENCODE_SERVER_PASSWORD_FILE: passwordFile,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(await child.exited).toBe(0)
      expect(await new Response(child.stdout).text()).toBe("auth-ok")
      expect(existsSync(passwordFile)).toBe(false)
    } finally {
      cleanupAuthDirectory()
      if (passwordFile) rmSync(passwordFile, { force: true })
      rmSync(sandbox, { recursive: true, force: true })
      if (authPassword === undefined) delete process.env["OPENCODE_SERVER_PASSWORD"]
      else process.env["OPENCODE_SERVER_PASSWORD"] = authPassword
    }
  })

  test("reuses a workspace discovered by exact label match without creating", async () => {
    const { deps, calls } = fakeOps((args) => {
      if (args[0] === "workspace" && args[1] === "list") {
        return ok(envelope({ workspaces: [{ workspace_id: "w2", label: "omo-agents-4242" }] }))
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok(envelope({ tab: { tab_id: "w2:t3" }, root_pane: { pane_id: "w2:p3" } }))
      }
      return ok("")
    })

    const result = await spawnHerdrSubagentTab(spawnArgs, deps)

    expect(result.success).toBe(true)
    expect(result.workspaceId).toBe("w2")
    expect(result.paneId).toBe("w2:p3")
    expect(calls.some((call) => call[0] === "workspace" && call[1] === "create")).toBe(false)
    expect(calls.find((call) => call[0] === "tab")?.[3]).toBe("w2")
  })

  test("skips discovery entirely when the manager already knows the workspace id", async () => {
    const { deps, calls } = fakeOps((args) => {
      if (args[0] === "tab" && args[1] === "create") {
        return ok(envelope({ tab: { tab_id: "w4:t5" }, root_pane: { pane_id: "w4:p5" } }))
      }
      return ok("")
    })

    const result = await spawnHerdrSubagentTab({ ...spawnArgs, workspaceId: "w4" }, deps)

    expect(result.success).toBe(true)
    expect(calls.map((call) => call[0])).toEqual(["tab", "pane"])
  })

  test("reports failure without throwing when the tab cannot be created", async () => {
    const { deps } = fakeOps((args) => {
      if (args[0] === "workspace" && args[1] === "list") return ok(envelope({ workspaces: [] }))
      if (args[0] === "workspace" && args[1] === "create") {
        return ok(envelope({ workspace: { workspace_id: "w3" }, root_pane: { pane_id: "w3:p1" } }))
      }
      return errorEnvelope("spawn_failed", "tab rejected")
    })

    const result = await spawnHerdrSubagentTab(spawnArgs, deps)

    expect(result.success).toBe(false)
    expect(result.error).toContain("tab rejected")
    expect(result.paneId).toBeUndefined()
  })
})

describe("herdrClosePaneIfExists", () => {
  test("maps success to closed, pane_not_found to gone, and rethrows real failures", async () => {
    const closed = await herdrClosePaneIfExists("w1:p1", fakeOps(() => ok("")).deps)
    expect(closed).toBe("closed")

    const gone = await herdrClosePaneIfExists(
      "w1:p1",
      fakeOps(() => errorEnvelope("pane_not_found", "pane w1:p1 not found")).deps,
    )
    expect(gone).toBe("gone")

    await expect(
      herdrClosePaneIfExists("w1:p1", fakeOps(() => errorEnvelope("server_error", "boom")).deps),
    ).rejects.toThrow("boom")
  })
})

describe("herdrListWorkspacesByLabelPrefix", () => {
  test("filters by the requested prefix only", async () => {
    const { deps } = fakeOps(() => ok(envelope({
      workspaces: [
        { workspace_id: "w1", label: "wb-repricer" },
        { workspace_id: "w2", label: "omo-team-abc" },
        { workspace_id: "w3", label: "omo-agents-111" },
        { workspace_id: "", label: "omo-agents-broken" },
      ],
    })))
    const listed = await herdrListWorkspacesByLabelPrefix("omo-agents-", deps)
    expect(listed).toEqual([{ workspaceId: "w3", label: "omo-agents-111" }])
  })
})

describe("isHerdrBinaryCallable", () => {
  test("accepts an existing pinned binary and a PATH-resolvable herdr", () => {
    expect(isHerdrBinaryCallable({ HERDR_BIN_PATH: join(import.meta.dir, "herdr-subagent.test.ts"), PATH: "" })).toBe(true)

    const dir = mkdtempSync(join(tmpdir(), "omo-herdr-bin-"))
    try {
      writeFileSync(join(dir, "herdr"), "#!/bin/sh\n")
      expect(isHerdrBinaryCallable({ PATH: dir })).toBe(true)
      expect(isHerdrBinaryCallable({ PATH: join(dir, "missing") })).toBe(false)
      expect(isHerdrBinaryCallable({ HERDR_BIN_PATH: "/nonexistent/herdr", PATH: "" })).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("sweepStaleHerdrAgentsWorkspacesWith", () => {
  const baseDeps = (overrides: Partial<Parameters<typeof sweepStaleHerdrAgentsWorkspacesWith>[0]> = {}) => ({
    listWorkspaces: async () => [
      { workspaceId: "w1", label: "omo-agents-111" },
      { workspaceId: "w2", label: "omo-agents-222-3" },
      { workspaceId: "w3", label: "omo-agents-999" },
      { workspaceId: "w4", label: "omo-agents-alive" },
    ],
    listAgents: async () => [],
    closeWorkspace: async () => undefined,
    processAlive: (pid: number) => pid === 888,
    currentPid: 777,
    log: () => undefined,
    ...overrides,
  })

  test("closes only workspaces of dead manager pids without live agents", async () => {
    const closed: string[] = []
    const removed = await sweepStaleHerdrAgentsWorkspacesWith(baseDeps({
      closeWorkspace: async (workspaceId) => {
        closed.push(workspaceId)
      },
    }))

    // w1 (dead pid), w2 (dead pid with manager suffix), w3 (dead pid) close;
    // w4 does not parse (no pid) and is skipped
    expect(removed).toEqual(["omo-agents-111", "omo-agents-222-3", "omo-agents-999"])
    expect(closed).toEqual(["w1", "w2", "w3"])
  })

  test("keeps the current manager's workspace and workspaces of live managers", async () => {
    const removed = await sweepStaleHerdrAgentsWorkspacesWith(baseDeps({
      listWorkspaces: async () => [
        { workspaceId: "w1", label: `omo-agents-777` },
        { workspaceId: "w2", label: "omo-agents-888" },
      ],
    }))
    expect(removed).toEqual([])
  })

  test("keeps a dead manager's workspace while a live agent remains in it", async () => {
    const removed = await sweepStaleHerdrAgentsWorkspacesWith(baseDeps({
      listAgents: async () => [{ paneId: "w1:p2" }],
    }))
    expect(removed).toEqual(["omo-agents-222-3", "omo-agents-999"])
  })

  test("survives close failures and keeps sweeping", async () => {
    const removed = await sweepStaleHerdrAgentsWorkspacesWith(baseDeps({
      closeWorkspace: async (workspaceId) => {
        if (workspaceId === "w1") throw new Error("close refused")
      },
    }))
    expect(removed).toEqual(["omo-agents-222-3", "omo-agents-999"])
  })
})
