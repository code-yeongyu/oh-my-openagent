import { describe, expect, it } from "bun:test"

import {
  createHerdrCommandClient,
} from "./herdr-command-client"
import { createHerdrCommandClientFromEnvironment } from "./herdr-environment"
import { executeHerdrCommand } from "./herdr-exec"

type CommandCall = {
  readonly file: string
  readonly args: readonly string[]
}

function createHarness(platform: NodeJS.Platform = "win32") {
  const calls: CommandCall[] = []
  const logCalls: Array<readonly [operation: string, path: string, value?: string]> = []
  const client = createHerdrCommandClient({
    herdrBin: "C:\\Program Files\\Herdr\\herdr.exe",
    platform,
    runtimeBin: "node",
    createOwnershipToken: () => "owner1",
    execute: async (file, args) => {
      calls.push({ file, args })
      if (args[0] === "tab" && args[1] === "create") {
        return JSON.stringify({
          result: {
            tab: { tab_id: "w1:t2" },
            root_pane: { pane_id: "w1:p2" },
          },
        })
      }
      return ""
    },
    logs: {
      create: async (taskId) => {
        const path = `C:\\Temp\\omo-herdr\\${taskId}.log`
        logCalls.push(["create", path])
        return {
          path,
          viewerPath: "C:\\Temp\\omo-herdr\\viewer.mjs",
          append: async (line) => {
            logCalls.push(["append", path, line])
          },
          remove: async () => {
            logCalls.push(["remove", path])
          },
        }
      },
    },
  })
  return { calls, client, logCalls }
}

describe("HerdrCommandClient", () => {
  it("terminates a hung Herdr process within the configured command budget", async () => {
    await expect(executeHerdrCommand(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1000)"],
      50,
    )).rejects.toThrow()
  })

  it("keeps task-controlled labels and paths in individual argv entries", async () => {
    const { calls, client } = createHarness()

    const created = await client.createTaskPane({
      workspaceId: "w1",
      cwd: "C:\\repo with spaces",
      label: "Explore auth; Write-Host injected",
      taskId: "st_child",
    })

    expect(created).toEqual({ tabId: "w1:t2", paneId: "w1:p2" })
    expect(calls).toEqual([
      {
        file: "C:\\Program Files\\Herdr\\herdr.exe",
        args: [
          "tab",
          "create",
          "--workspace",
          "w1",
          "--cwd",
          "C:\\repo with spaces",
          "--label",
          "Explore auth; Write-Host injected [omo:owner1]",
          "--env",
          "OMO_HERDR_TASK_LOG=C:\\Temp\\omo-herdr\\st_child.log",
          "--no-focus",
        ],
      },
      {
        file: "C:\\Program Files\\Herdr\\herdr.exe",
        args: ["tab", "rename", "w1:t2", "Explore auth; Write-Host injected"],
      },
    ])
  })

  it("reconciles a tab created before an uncertain create failure", async () => {
    const calls: string[][] = []
    let ownershipLabel = ""
    let removed = false
    const client = createHerdrCommandClient({
      herdrBin: "herdr",
      platform: "win32",
      createOwnershipToken: () => "uncertain",
      execute: async (_file, args) => {
        calls.push([...args])
        if (args[0] === "tab" && args[1] === "create") {
          ownershipLabel = args[args.indexOf("--label") + 1] ?? ""
          throw new Error("create timed out")
        }
        if (args[0] === "tab" && args[1] === "list") {
          return JSON.stringify({
            result: {
              type: "tab_list",
              tabs: [{
                tab_id: "w1:t9",
                workspace_id: "w1",
                label: ownershipLabel,
                number: 9,
                pane_count: 1,
                focused: false,
                agent_status: "unknown",
              }],
            },
          })
        }
        return ""
      },
      logs: {
        create: async () => ({
          path: "C:\\Temp\\uncertain.log",
          viewerPath: "C:\\Temp\\viewer.mjs",
          append: async () => {},
          remove: async () => {
            removed = true
          },
        }),
      },
    })

    await expect(client.createTaskPane({
      workspaceId: "w1",
      cwd: "C:\\repo",
      label: "Explore auth",
      taskId: "st_child",
    })).rejects.toThrow("create timed out")

    expect(calls).toContainEqual(["tab", "list", "--workspace", "w1"])
    expect(calls).toContainEqual(["tab", "close", "w1:t9"])
    expect(removed).toBe(true)
  })

  it("retries log cleanup after a closed tab reports not found", async () => {
    let closes = 0
    let removals = 0
    const client = createHerdrCommandClient({
      herdrBin: "herdr",
      platform: "win32",
      createOwnershipToken: () => "cleanup",
      execute: async (_file, args) => {
        if (args[0] === "tab" && args[1] === "create") {
          return JSON.stringify({
            result: {
              tab: { tab_id: "w1:t2" },
              root_pane: { pane_id: "w1:p2" },
            },
          })
        }
        if (args[0] === "tab" && args[1] === "close") {
          closes += 1
          if (closes === 2) throw new Error("tab not found")
        }
        return ""
      },
      logs: {
        create: async () => ({
          path: "C:\\Temp\\cleanup.log",
          viewerPath: "C:\\Temp\\viewer.mjs",
          append: async () => {},
          remove: async () => {
            removals += 1
            if (removals === 1) throw new Error("remove failed")
          },
        }),
      },
    })
    await client.createTaskPane({
      workspaceId: "w1",
      cwd: "C:\\repo",
      label: "Explore auth",
      taskId: "st_child",
    })

    await expect(client.closeTab("w1:t2")).rejects.toThrow("remove failed")
    await expect(client.closeTab("w1:t2")).resolves.toBeUndefined()

    expect(closes).toBe(2)
    expect(removals).toBe(2)
  })

  it("starts a runtime-backed viewer without shell-specific syntax", async () => {
    const { calls, client, logCalls } = createHarness("win32")
    await client.createTaskPane({
      workspaceId: "w1",
      cwd: "C:\\repo",
      label: "Explore auth",
      taskId: "st_child",
    })
    calls.length = 0
    logCalls.length = 0

    await client.startViewer("w1:p2")

    expect(calls.map((call) => call.args)).toEqual([
      [
        "pane",
        "run",
        "w1:p2",
        "node \"C:\\Temp\\omo-herdr\\viewer.mjs\"",
      ],
      ["pane", "wait-output", "w1:p2", "--match", "OMO_NATIVE_VIEWER_READY", "--timeout", "10000"],
    ])
    expect(logCalls).toEqual([
      ["append", "C:\\Temp\\omo-herdr\\st_child.log", "OMO_NATIVE_VIEWER_READY"],
    ])
  })

  it("reports identity, presentation, output, and ordered cleanup", async () => {
    const { calls, client, logCalls } = createHarness()
    await client.createTaskPane({
      workspaceId: "w1",
      cwd: "C:\\repo",
      label: "Inspect auth",
      taskId: "st_child",
    })
    calls.length = 0
    logCalls.length = 0

    await client.reportTask({
      paneId: "w1:p2",
      taskId: "st_child",
      agentType: "explore",
      title: "Inspect auth",
      state: "working",
      stateLabel: "running",
      message: "running",
      sessionId: "session-child",
      sequence: 1,
    })
    await client.writeLine("w1:p2", "[running] Inspect auth")
    await client.releaseTask("w1:p2", "st_child", 2)
    await client.closeTab("w1:t2")

    expect(calls.map((call) => call.args)).toEqual([
      [
        "pane",
        "report-agent",
        "w1:p2",
        "--source",
        "omo:native-task",
        "--agent",
        "omo",
        "--state",
        "working",
        "--message",
        "running",
        "--seq",
        "1",
      ],
      [
        "pane",
        "report-metadata",
        "w1:p2",
        "--source",
        "omo:native-task-display",
        "--agent",
        "omo",
        "--applies-to-source",
        "omo:native-task",
        "--title",
        "Inspect auth",
        "--display-agent",
        "explore",
        "--state-label",
        "working=running",
        "--token",
        "task=st_child",
        "--token",
        "session=session-child",
        "--seq",
        "1",
      ],
      ["agent", "rename", "w1:p2", "omo_st_child"],
      [
        "pane",
        "release-agent",
        "w1:p2",
        "--source",
        "omo:native-task",
        "--agent",
        "omo",
        "--seq",
        "2",
      ],
      ["tab", "close", "w1:t2"],
    ])
    expect(logCalls).toEqual([
      ["append", "C:\\Temp\\omo-herdr\\st_child.log", "[running] Inspect auth"],
      ["remove", "C:\\Temp\\omo-herdr\\st_child.log"],
    ])
  })

  it("stays disabled outside a Herdr workspace", () => {
    expect(createHerdrCommandClientFromEnvironment({ PATH: "C:\\Windows" })).toBeUndefined()
  })
})
