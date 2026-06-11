import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerTargetTeamTools, type TargetToolDefinition } from "."

let cwd = ""
afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true })
  cwd = ""
})

function text(result: Awaited<ReturnType<TargetToolDefinition["execute"]>> | undefined): string {
  const content = result?.content[0]
  return content?.type === "text" ? content.text : ""
}

describe("target Team Mode tools", () => {
  it("#given Team Mode enabled #when create message and task lifecycle runs #then source runtime worktrees and tmux layout are activated", async () => {
    cwd = mkdtempSync(join(tmpdir(), "omo-target-team-"))
    const tools = new Map<string, TargetToolDefinition>()
    const tmuxCalls: string[][] = []
    registerTargetTeamTools({
      host: "pi",
      cwd,
      enabled: true,
      registry: { registerTool: (tool) => tools.set(tool.name, tool) },
      deps: {
        getTmuxPath: async () => "tmux",
        runTmuxCommand: async (_tmuxPath, args) => {
          tmuxCalls.push(args)
          if (args[0] === "new-session") return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
          if (args[0] === "list-panes") return { success: true, output: "%1", stdout: "%1", stderr: "", exitCode: 0 }
          if (args[0] === "split-window") return { success: true, output: "%2", stdout: "%2", stderr: "", exitCode: 0 }
          return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
        },
      },
    })

    const created = await tools.get("team_create")?.execute("1", { team_name: "alpha", members: ["sisyphus", "atlas"] })
    const createdState = JSON.parse(text(created))
    await tools.get("team_send_message")?.execute("2", { team_name: "alpha", body: "hello" })
    const task = await tools.get("team_task_create")?.execute("3", { team_name: "alpha", subject: "work" })
    const taskState = JSON.parse(text(task))
    const tasks = await tools.get("team_task_list")?.execute("4", { team_name: "alpha" })
    const status = await tools.get("team_status")?.execute("5", { team_name: "alpha" })
    const statusState = JSON.parse(text(status))

    expect(tools).toHaveLength(12)
    expect(createdState.status).toBe("active")
    expect(createdState.tmuxLayout.targetSessionId).toMatch(/^omo-target-team-/)
    expect(statusState.members[0].worktreePath).toContain(join(".omo", "target-team-mode", "worktrees"))
    expect(statusState.members[0].tmuxPaneId).toBe("%1")
    expect(statusState.members[1].tmuxPaneId).toBe("%2")
    expect(existsSync(statusState.members[0].worktreePath)).toBe(true)
    expect(text(tasks)).toContain(taskState.id)
    expect(tmuxCalls.some((args) => args[0] === "new-session")).toBe(true)

    const rejected = await tools.get("team_create")?.execute("6", { team_name: "bad", members: ["oracle"] })
    expect(rejected?.isError).toBe(true)
  })

  it("#given target model uses name alias #when team task lifecycle runs #then the named team is indexed consistently", async () => {
    cwd = mkdtempSync(join(tmpdir(), "omo-target-team-alias-"))
    const tools = new Map<string, TargetToolDefinition>()
    registerTargetTeamTools({
      host: "oh-my-pi",
      cwd,
      enabled: true,
      registry: { registerTool: (tool) => tools.set(tool.name, tool) },
      deps: {
        getTmuxPath: async () => null,
        runTmuxCommand: async () => ({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 }),
      },
    })

    const created = await tools.get("team_create")?.execute("1", { name: "fullrun", members: ["sisyphus", "atlas"] })
    const createdState = JSON.parse(text(created))
    const task = await tools.get("team_task_create")?.execute("2", { name: "fullrun", subject: "alias work" })
    const taskState = JSON.parse(text(task))
    const tasks = await tools.get("team_task_list")?.execute("3", { name: "fullrun" })
    const status = await tools.get("team_status")?.execute("4", { name: "fullrun" })
    const statusState = JSON.parse(text(status))

    expect(createdState.teamName).toBe("fullrun")
    expect(statusState.members.map((member: { name: string }) => member.name)).toEqual(["sisyphus", "atlas"])
    expect(text(tasks)).toContain(taskState.id)
    expect(text(tasks)).toContain("alias work")
  })
})
