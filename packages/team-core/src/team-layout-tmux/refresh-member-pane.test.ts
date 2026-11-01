import { describe, expect, test } from "bun:test"
import { buildAttachCommand, decideMemberPaneRefresh, refreshMemberPane, type MemberPaneSnapshot, type RefreshMemberPaneDeps } from "./refresh-member-pane"
function createDeps(overrides?: Partial<RefreshMemberPaneDeps>): { deps: RefreshMemberPaneDeps; calls: Array<{ args: Array<string> }> } {
  const calls: Array<{ args: Array<string> }> = []
  const deps: RefreshMemberPaneDeps = {
    runTmuxCommand: async (_tmuxPath, args) => {
      calls.push({ args })
      if (args[0] === "display-message") {
        return { success: true, output: ["http://127.0.0.1:4096", "ses_member", "0", "opencode"].join("\t") }
      }
      return { success: true, output: "" }
    },
    getTmuxPath: async () => "tmux",
    log: () => {},
    ...overrides,
  }
  return { deps, calls }
}

const aliveSnapshot: MemberPaneSnapshot = {
  paneId: "%7",
  attachServerUrl: "http://127.0.0.1:4096",
  attachSessionId: "ses_member",
  dead: false,
  currentCommand: "opencode",
}

describe("refresh-member-pane", () => {
  describe("#decideMemberPaneRefresh", () => {
    test("#given alive attach pane #then decides redraw", () => {
      expect(decideMemberPaneRefresh(aliveSnapshot)).toBe("redraw")
    })

    test("#given dead pane #then decides revive", () => {
      expect(decideMemberPaneRefresh({ ...aliveSnapshot, dead: true })).toBe("revive")
    })

    test("#given attach exited back to a shell #then decides revive", () => {
      expect(decideMemberPaneRefresh({ ...aliveSnapshot, currentCommand: "bash" })).toBe("revive")
      expect(decideMemberPaneRefresh({ ...aliveSnapshot, currentCommand: "zsh" })).toBe("revive")
    })

    test("#given pane without omo attach metadata #then decides none", () => {
      expect(decideMemberPaneRefresh({ ...aliveSnapshot, attachServerUrl: "", attachSessionId: "" })).toBe("none")
    })
  })

  describe("#buildAttachCommand", () => {
    test("#given member and server url #then quotes every interpolated value", () => {
      const command = buildAttachCommand(
        { name: "worker", sessionId: "ses 'quoted'", worktreePath: "/tmp/wt dir" },
        "http://127.0.0.1:4096",
      )
      expect(command).toBe("opencode attach 'http://127.0.0.1:4096' --session 'ses '\\''quoted'\\''' --dir '/tmp/wt dir'")
    })
  })

  describe("#refreshMemberPane", () => {
    test("#given alive attach pane #when refreshed #then sends redraw keystroke to the pane", async () => {
      const { deps, calls } = createDeps()
      const outcome = await refreshMemberPane({ name: "worker", sessionId: "ses_member", paneId: "%7" }, deps)
      expect(outcome).toBe("redraw")
      expect(calls.some((call) => call.args[0] === "display-message")).toBe(true)
      const sendKeys = calls.find((call) => call.args[0] === "send-keys")
      expect(sendKeys?.args).toEqual(["send-keys", "-t", "%7", "C-l"])
    })

    test("#given dead pane #when refreshed #then re-sends the attach command into the pane", async () => {
      const { deps, calls } = createDeps({
        runTmuxCommand: async (_tmuxPath, args) => {
          calls.push({ args })
          if (args[0] === "display-message") {
            return { success: true, output: ["http://127.0.0.1:4096", "ses_member", "1", ""].join("\t") }
          }
          return { success: true, output: "" }
        },
      })
      const outcome = await refreshMemberPane(
        { name: "worker", sessionId: "ses_member", paneId: "%7", worktreePath: "/tmp/wt" },
        deps,
      )
      expect(outcome).toBe("revive")
      const sendKeys = calls.find((call) => call.args[0] === "send-keys")
      expect(sendKeys?.args).toEqual([
        "send-keys",
        "-t",
        "%7",
        "opencode attach 'http://127.0.0.1:4096' --session 'ses_member' --dir '/tmp/wt'",
        "Enter",
      ])
    })

    test("#given pane lost its omo attach metadata #when refreshed #then issues no further tmux commands", async () => {
      const { deps, calls } = createDeps({
        runTmuxCommand: async (_tmuxPath, args) => {
          calls.push({ args })
          if (args[0] === "display-message") {
            return { success: true, output: "\t\t0\tbash" }
          }
          return { success: true, output: "" }
        },
      })
      const outcome = await refreshMemberPane({ name: "worker", sessionId: "ses_member", paneId: "%7" }, deps)
      expect(outcome).toBe("none")
      expect(calls.length).toBe(1)
    })

    test("#given display-message fails #when refreshed #then returns none without throwing", async () => {
      const { deps, calls } = createDeps({
        runTmuxCommand: async (_tmuxPath, args) => {
          calls.push({ args })
          return { success: false, output: "" }
        },
      })
      const outcome = await refreshMemberPane({ name: "worker", sessionId: "ses_member", paneId: "%7" }, deps)
      expect(outcome).toBe("none")
    })

    test("#given tmux command rejects #when refreshed #then logs and returns none instead of throwing", async () => {
      const logged: Array<unknown> = []
      const deps: RefreshMemberPaneDeps = {
        runTmuxCommand: async () => {
          throw new Error("tmux exploded")
        },
        getTmuxPath: async () => "tmux",
        log: (_message, payload) => {
          logged.push(payload)
        },
      }
      const outcome = await refreshMemberPane({ name: "worker", sessionId: "ses_member", paneId: "%7" }, deps)
      expect(outcome).toBe("none")
      expect(logged.length).toBeGreaterThan(0)
    })
  })
})
