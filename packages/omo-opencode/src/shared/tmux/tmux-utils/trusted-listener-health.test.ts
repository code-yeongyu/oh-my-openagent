/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult, TmuxConfig } from "@oh-my-opencode/tmux-core"
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

const healthPath = "/global/health"
const password = "adapter-listener-password-fixture"

type Contact = {
  readonly path: string
  readonly authorization: string | null
}

function tmuxResult(output: string, exitCode: number): TmuxCommandResult {
  return {
    success: exitCode === 0,
    output,
    stdout: output,
    stderr: "",
    exitCode,
  }
}

function createTmuxRunner(onCommand?: () => void) {
  return async (_command: string, args: string[]): Promise<TmuxCommandResult> => {
    onCommand?.()
    switch (args[0]) {
      case "split-window":
        return tmuxResult("%pane", 0)
      case "new-window":
        return tmuxResult("%window", 0)
      case "has-session":
        return tmuxResult("", 1)
      case "new-session":
        return tmuxResult("%session", 0)
      case "select-pane":
        return tmuxResult("", 0)
      default:
        throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }
  }
}

function createProtectedListener(contacts: Contact[], expectedAuthorization: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      const authorization = request.headers.get("authorization")
      contacts.push({ path, authorization })
      if (path !== healthPath) return new Response(null, { status: 404 })
      return new Response(null, { status: authorization === expectedAuthorization ? 200 : 401 })
    },
  })
}

function restoreEnvironmentVariable(name: "OPENCODE_SERVER_PASSWORD" | "OPENCODE_SERVER_USERNAME", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

describe("OMO trusted tmux listener health", () => {
  it("#given a password-protected listener #when public pane, window, and session wrappers spawn with partial deps #then each authenticates and succeeds", async () => {
    // given
    const environment = {
      password: process.env.OPENCODE_SERVER_PASSWORD,
      username: process.env.OPENCODE_SERVER_USERNAME,
    }
    const contacts: Contact[] = []
    const expectedAuthorization = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
    process.env.OPENCODE_SERVER_PASSWORD = password
    delete process.env.OPENCODE_SERVER_USERNAME

    try {
      const server = createProtectedListener(contacts, expectedAuthorization)

      try {
        const deps = {
          log: () => undefined,
          runTmuxCommand: createTmuxRunner(),
          isInsideTmux: () => true,
          getTmuxPath: async () => "tmux",
        }
        const serverUrl = `http://127.0.0.1:${server.port}`

        // when
        const pane = await spawnTmuxPane("pane-session", "pane", enabledTmuxConfig, `${serverUrl}?caller=pane`, "/tmp", undefined, "-h", deps)
        const window = await spawnTmuxWindow("window-session", "window", enabledTmuxConfig, `${serverUrl}?caller=window`, "/tmp", deps)
        const session = await spawnTmuxSession("tmux-session", "session", enabledTmuxConfig, `${serverUrl}?caller=session`, "/tmp", undefined, deps)

        // then
        expect({
          results: [pane, window, session],
          contacted: contacts.length > 0,
          exactHealthPath: contacts.every((contact) => contact.path === healthPath),
          authenticated: contacts.every((contact) => contact.authorization === expectedAuthorization),
        }).toEqual({
          results: [
            { success: true, paneId: "%pane" },
            { success: true, paneId: "%window" },
            { success: true, paneId: "%session" },
          ],
          contacted: true,
          exactHealthPath: true,
          authenticated: true,
        })
      } finally {
        await server.stop(true)
      }
    } finally {
      restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", environment.password)
      restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", environment.username)
    }
  })

  it("#given an explicit unavailable health override #when public pane, window, and session wrappers spawn #then the override prevents every spawn", async () => {
    // given
    const environment = {
      password: process.env.OPENCODE_SERVER_PASSWORD,
      username: process.env.OPENCODE_SERVER_USERNAME,
    }
    const contacts: Contact[] = []
    const expectedAuthorization = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
    let tmuxCommands = 0
    process.env.OPENCODE_SERVER_PASSWORD = password
    delete process.env.OPENCODE_SERVER_USERNAME

    try {
      const server = createProtectedListener(contacts, expectedAuthorization)

      try {
        const deps = {
          log: () => undefined,
          runTmuxCommand: createTmuxRunner(() => tmuxCommands++),
          isInsideTmux: () => true,
          getTmuxPath: async () => "tmux",
          isServerRunning: async () => false,
        }
        const serverUrl = `http://127.0.0.1:${server.port}`

        // when
        const pane = await spawnTmuxPane("pane-override", "pane", enabledTmuxConfig, `${serverUrl}?caller=pane`, "/tmp", undefined, "-h", deps)
        const window = await spawnTmuxWindow("window-override", "window", enabledTmuxConfig, `${serverUrl}?caller=window`, "/tmp", deps)
        const session = await spawnTmuxSession("session-override", "session", enabledTmuxConfig, `${serverUrl}?caller=session`, "/tmp", undefined, deps)

        // then
        expect(pane).toEqual({ success: false })
        expect(window).toEqual({ success: false })
        expect(session).toEqual({ success: false })
        expect(contacts).toEqual([])
        expect(tmuxCommands).toBe(0)
      } finally {
        await server.stop(true)
      }
    } finally {
      restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", environment.password)
      restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", environment.username)
    }
  })
})
