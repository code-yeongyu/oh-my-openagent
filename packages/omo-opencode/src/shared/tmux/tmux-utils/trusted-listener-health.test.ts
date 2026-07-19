/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult, TmuxConfig, TmuxServerAccess } from "@oh-my-opencode/tmux-core"
import { createOpenCodeTmuxServerAccess } from "../opencode-server-access"
import { activateTmuxPane } from "./pane-activate"
import { replaceTmuxPane } from "./pane-replace"
import { spawnTmuxPane } from "./pane-spawn"
import { spawnTmuxSession } from "./session-spawn"
import { spawnTmuxWindow } from "./window-spawn"

const enabledTmuxConfig = {
  enabled: true,
  layout: "main-vertical",
  main_pane_size: 60,
  main_pane_min_width: 120,
  agent_pane_min_width: 40,
  isolation: "inline",
} satisfies TmuxConfig

function tmuxResult(output: string, exitCode: number = 0): TmuxCommandResult {
  return {
    success: exitCode === 0,
    output,
    stdout: output,
    stderr: "",
    exitCode,
  }
}

function createTmuxRecorder() {
  const commands: string[][] = []
  return {
    commands,
    runTmuxCommand: async (_command: string, args: string[]): Promise<TmuxCommandResult> => {
      commands.push(args)
      switch (args[0]) {
        case "split-window": return tmuxResult("%pane")
        case "new-window": return tmuxResult("%window")
        case "has-session": return tmuxResult("", 1)
        case "new-session": return tmuxResult("%session")
        default: return tmuxResult("")
      }
    },
  }
}

function creationCommands(commands: string[][]): string[][] {
  return commands.filter((args) => (
    args[0] === "split-window"
    || args[0] === "new-window"
    || args[0] === "new-session"
    || args[0] === "respawn-pane"
  ))
}

describe("OMO tmux listener access", () => {
  it("propagates one trusted capability through pane, window, session, replace, and activate", async () => {
    const contacts: Array<string | null> = []
    const recorder = createTmuxRecorder()
    const access = createOpenCodeTmuxServerAccess({
      serverUrl: "http://127.0.0.1:5317",
      source: "current-context",
      trusted: true,
    }, {
      getEnvironment: () => ({ OPENCODE_SERVER_PASSWORD: "trusted-password" }),
      fetchImplementation: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        contacts.push(new Headers(init?.headers).get("authorization"))
        return new Response(null, { status: 200 })
      }) as typeof fetch,
    })
    const spawnDeps = {
      log: () => undefined,
      runTmuxCommand: recorder.runTmuxCommand,
      isInsideTmux: () => true,
      getTmuxPath: async () => "tmux",
    }

    const pane = await spawnTmuxPane("pane-session", "pane", enabledTmuxConfig, access, "/tmp", undefined, "-h", spawnDeps)
    const window = await spawnTmuxWindow("window-session", "window", enabledTmuxConfig, access, "/tmp", spawnDeps)
    const session = await spawnTmuxSession("session-session", "session", enabledTmuxConfig, access, "/tmp", undefined, spawnDeps)
    const replaced = await replaceTmuxPane("%replace", "replace-session", "replace", enabledTmuxConfig, access, "/tmp", spawnDeps)
    const activated = await activateTmuxPane("%activate", "activate-session", access, "/tmp", spawnDeps)

    expect([pane.success, window.success, session.success, replaced.success, activated]).toEqual([
      true, true, true, true, true,
    ])
    expect(contacts).toEqual([
      `Basic ${Buffer.from("opencode:trusted-password", "utf8").toString("base64")}`,
    ])
    const created = creationCommands(recorder.commands)
    expect(created).toHaveLength(5)
    expect(created.every((args) => args.includes("OPENCODE_SERVER_PASSWORD=trusted-password"))).toBe(true)
    expect(created.every((args) => args.includes("OPENCODE_SERVER_USERNAME=opencode"))).toBe(true)
    const activateCommand = created.at(-1)?.at(-1) ?? ""
    expect(activateCommand).toContain("opencode attach")
    expect(activateCommand).not.toContain("trusted-password")
  })

  it("converts raw URLs to anonymous access and actively clears inherited credentials", async () => {
    const originalPassword = process.env.OPENCODE_SERVER_PASSWORD
    const originalUsername = process.env.OPENCODE_SERVER_USERNAME
    const recorder = createTmuxRecorder()
    const rawServerUrl = "http://127.0.0.1:5318"
    const spawnDeps = {
      log: () => undefined,
      runTmuxCommand: recorder.runTmuxCommand,
      isInsideTmux: () => true,
      isServerRunning: async () => true,
      getTmuxPath: async () => "tmux",
    }
    process.env.OPENCODE_SERVER_PASSWORD = "ambient-password"
    process.env.OPENCODE_SERVER_USERNAME = "ambient-user"

    try {
      await spawnTmuxPane("pane-session", "pane", enabledTmuxConfig, rawServerUrl, "/tmp", undefined, "-h", spawnDeps)
      await spawnTmuxWindow("window-session", "window", enabledTmuxConfig, rawServerUrl, "/tmp", spawnDeps)
      await spawnTmuxSession("session-session", "session", enabledTmuxConfig, rawServerUrl, "/tmp", undefined, spawnDeps)
      await replaceTmuxPane("%replace", "replace-session", "replace", enabledTmuxConfig, rawServerUrl, "/tmp", spawnDeps)
      await activateTmuxPane("%activate", "activate-session", rawServerUrl, "/tmp", spawnDeps)

      const created = creationCommands(recorder.commands)
      expect(created).toHaveLength(5)
      expect(created.every((args) => args.includes("OPENCODE_SERVER_PASSWORD="))).toBe(true)
      expect(created.every((args) => args.includes("OPENCODE_SERVER_USERNAME="))).toBe(true)
      expect(created.some((args) => args.some((arg) => arg.includes("ambient-password") || arg.includes("ambient-user")))).toBe(false)
    } finally {
      if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = originalPassword
      if (originalUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
      else process.env.OPENCODE_SERVER_USERNAME = originalUsername
    }
  })

  it("lets an explicit per-call health override win without calling bound health", async () => {
    const recorder = createTmuxRecorder()
    let boundHealthCalls = 0
    const access: TmuxServerAccess = {
      serverUrl: "http://127.0.0.1:5319",
      checkServerHealth: async () => {
        boundHealthCalls += 1
        return true
      },
      getPaneEnvironment: () => ({ HARNESS_TOKEN: "kept" }),
    }
    const deps = {
      log: () => undefined,
      runTmuxCommand: recorder.runTmuxCommand,
      isInsideTmux: () => true,
      isServerRunning: async () => false,
      getTmuxPath: async () => "tmux",
    }

    const pane = await spawnTmuxPane("pane", "pane", enabledTmuxConfig, access, "/tmp", undefined, "-h", deps)
    const window = await spawnTmuxWindow("window", "window", enabledTmuxConfig, access, "/tmp", deps)
    const session = await spawnTmuxSession("session", "session", enabledTmuxConfig, access, "/tmp", undefined, deps)

    expect([pane.success, window.success, session.success]).toEqual([false, false, false])
    expect(boundHealthCalls).toBe(0)
    expect(recorder.commands).toEqual([])
  })
})
