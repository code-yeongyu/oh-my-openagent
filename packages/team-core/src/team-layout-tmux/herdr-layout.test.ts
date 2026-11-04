import { describe, expect, test } from "bun:test"
import { createTeamLayout, removeTeamLayout } from "./layout"
import type { HerdrExecResult, HerdrOpsDeps, RunHerdrCommand } from "@oh-my-opencode/tmux-core"

function envelope(result: unknown): string {
  return JSON.stringify({ id: "cli:test", result })
}

function fakeHerdrOps(
  script: (args: ReadonlyArray<string>) => HerdrExecResult,
): { ops: HerdrOpsDeps; calls: string[][] } {
  const calls: string[][] = []
  const run: RunHerdrCommand = async (args) => {
    calls.push([...args])
    return script(args)
  }
  return { ops: { runHerdrCommand: run, ensureServer: async () => "running" }, calls }
}

function baseDeps(ops: HerdrOpsDeps) {
  return {
    runTmuxCommand: async () => ({ success: false, output: "", error: "tmux must not be used on the herdr backend" }),
    isServerRunning: async () => true,
    getTmuxPath: async () => null,
    resolveCallerTmuxSession: async () => null,
    log: () => {},
    herdrOps: ops,
  } as const
}

const members = [
  { name: "worker-1", sessionId: "sess-1", worktreePath: "/repo/wt1" },
  { name: "worker-2", sessionId: "sess-2", worktreePath: "/repo/wt2" },
]

const tmuxMgr = { getServerUrl: () => "http://127.0.0.1:1", getCtxServerUrl: () => undefined }

describe("createTeamLayout on the herdr backend", () => {
  test("creates one workspace and one tab per member, delivering attach via pane run", async () => {
    // given
    let tabIndex = 0
    const { ops, calls } = fakeHerdrOps((args) => {
      if (args[0] === "workspace" && args[1] === "create") {
        return { success: true, output: envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }) }
      }
      if (args[0] === "tab" && args[1] === "create") {
        tabIndex += 1
        return { success: true, output: envelope({ tab: { tab_id: `w9:t${tabIndex + 1}` }, root_pane: { pane_id: `w9:p${tabIndex + 1}` } }) }
      }
      return { success: true, output: "" }
    })

    // when
    const layout = await createTeamLayout("11111111-2222-3333-4444-555555555555", members, tmuxMgr, baseDeps(ops), { multiplexer: "herdr" })

    // then
    expect(layout).not.toBeNull()
    expect(layout?.targetSessionId).toBe("w9")
    expect(layout?.ownedSession).toBe(true)
    expect(layout?.focusPanesByMember).toEqual({ "worker-1": "w9:p2", "worker-2": "w9:p3" })

    const flat = calls.map((call) => `${call[0]} ${call[1]}`)
    expect(flat.filter((entry) => entry === "workspace create")).toHaveLength(1)
    expect(flat.filter((entry) => entry === "tab create")).toHaveLength(2)

    const tabCreates = calls.filter((call) => call[0] === "tab" && call[1] === "create")
    for (const tabCreate of tabCreates) {
      expect(tabCreate).toContain("--workspace")
      expect(tabCreate).toContain("w9")
    }
    const runs = calls.filter((call) => call[0] === "pane" && call[1] === "run")
    expect(runs).toHaveLength(2)
    for (const run of runs) {
      expect(run[3]).toContain("opencode attach")
      expect(run[3]).toContain("--session")
    }
  })

  test("never touches tmux and works outside a tmux session", async () => {
    // given
    const originalTmux = process.env.TMUX
    delete process.env.TMUX
    try {
      const { ops, calls } = fakeHerdrOps(() => ({ success: true, output: "" }))

      // when
      const layout = await createTeamLayout("11111111-2222-3333-4444-555555555555", members.slice(0, 1), tmuxMgr, baseDeps(ops), { multiplexer: "herdr" })

      // then
      // workspace create fails silently in the fake (no workspace_id) -> null,
      // and crucially no tmux command was attempted.
      expect(calls.every((call) => call[0] !== "kill-session")).toBe(true)
      expect(layout).toBeNull()
    } finally {
      if (originalTmux !== undefined) process.env.TMUX = originalTmux
    }
  })

  test("closes the half-built workspace when a member tab fails and no live agent remains", async () => {
    // given
    let tabIndex = 0
    const { ops, calls } = fakeHerdrOps((args) => {
      if (args[0] === "workspace" && args[1] === "create") {
        return { success: true, output: envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }) }
      }
      if (args[0] === "tab" && args[1] === "create") {
        tabIndex += 1
        if (tabIndex > 1) return { success: false, output: "", error: "tab rejected", code: "spawn_failed" }
        return { success: true, output: envelope({ tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p2" } }) }
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { success: true, output: envelope({ agents: [] }) }
      }
      return { success: true, output: "" }
    })

    // when
    const layout = await createTeamLayout("11111111-2222-3333-4444-555555555555", members, tmuxMgr, baseDeps(ops), { multiplexer: "herdr" })

    // then
    // member 2's tab create fails -> null layout, and the failure rollback
    // checks liveness then closes the workspace it created
    expect(layout).toBeNull()
    const agentList = calls.find((call) => call[0] === "agent" && call[1] === "list")
    expect(agentList).toBeDefined()
    expect(calls).toContainEqual(["workspace", "close", "w9"])
  })

  test("keeps the half-built workspace when a live agent remains in it", async () => {
    // given
    let tabIndex = 0
    const { ops, calls } = fakeHerdrOps((args) => {
      if (args[0] === "workspace" && args[1] === "create") {
        return { success: true, output: envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }) }
      }
      if (args[0] === "tab" && args[1] === "create") {
        tabIndex += 1
        if (tabIndex > 1) return { success: false, output: "", error: "tab rejected", code: "spawn_failed" }
        return { success: true, output: envelope({ tab: { tab_id: "w9:t2" }, root_pane: { pane_id: "w9:p2" } }) }
      }
      if (args[0] === "agent" && args[1] === "list") {
        // member 1's attach is already running: the workspace survives
        return { success: true, output: envelope({ agents: [{ pane_id: "w9:p2", name: "worker-1" }] }) }
      }
      return { success: true, output: "" }
    })

    // when
    const layout = await createTeamLayout("11111111-2222-3333-4444-555555555555", members, tmuxMgr, baseDeps(ops), { multiplexer: "herdr" })

    // then
    expect(layout).toBeNull()
    expect(calls).not.toContainEqual(["workspace", "close", "w9"])
  })

  test("survives a liveness-probe failure during the failure rollback", async () => {
    // given
    const { ops, calls } = fakeHerdrOps((args) => {
      if (args[0] === "workspace" && args[1] === "create") {
        return { success: true, output: envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }) }
      }
      if (args[0] === "agent" && args[1] === "list") {
        return { success: false, output: "", error: "server went away", code: "server_not_running" }
      }
      return { success: false, output: "", error: "tab rejected", code: "spawn_failed" }
    })

    // when
    const layout = await createTeamLayout("11111111-2222-3333-4444-555555555555", members, tmuxMgr, baseDeps(ops), { multiplexer: "herdr" })

    // then
    // rollback is best-effort: probe failure means no close, no throw
    expect(layout).toBeNull()
    expect(calls).not.toContainEqual(["workspace", "close", "w9"])
  })
})

describe("removeTeamLayout on the herdr backend", () => {
  test("closes the workspace when the cleanup target carries herdr panes", async () => {
    // given
    const { ops, calls } = fakeHerdrOps(() => ({ success: true, output: envelope({ type: "ok" }) }))

    // when
    await removeTeamLayout(
      "11111111-2222-3333-4444-555555555555",
      { ownedSession: true, targetSessionId: "w9", paneIds: ["w9:p2", "w9:p3"] },
      baseDeps(ops),
    )

    // then
    expect(calls).toEqual([["workspace", "close", "w9"]])
  })

  test("falls back to per-pane closes without a workspace target", async () => {
    // given
    const { ops, calls } = fakeHerdrOps(() => ({ success: true, output: envelope({ type: "ok" }) }))

    // when
    await removeTeamLayout(
      "11111111-2222-3333-4444-555555555555",
      { ownedSession: false, targetSessionId: "", paneIds: ["w9:p2"] },
      baseDeps(ops),
    )

    // then
    expect(calls).toEqual([["pane", "close", "w9:p2"]])
  })
})
