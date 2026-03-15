import { describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"

import type { BackgroundManager } from "../background-agent"
import { launchTeamWorkers } from "./orchestrator"

function createBackgroundManagerMock() {
  const launchedTasks = new Map<
    string,
    {
      id: string
      sessionID: string
      paneId: string
      windowId: string
    }
  >()

  const launch = mock(async (input: Parameters<BackgroundManager["launch"]>[0]) => {
    const id = `${input.description.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`
    const index = launchedTasks.size + 1
    launchedTasks.set(id, {
      id,
      sessionID: `${id}-session`,
      paneId: `%${index}`,
      windowId: "@1",
    })

    return { id } as Awaited<ReturnType<BackgroundManager["launch"]>>
  })

  const getTask = mock((taskId: string) => {
    const task = launchedTasks.get(taskId)
    return task as ReturnType<BackgroundManager["getTask"]>
  })

  return {
    backgroundManager: {
      launch,
      getTask,
    } as unknown as BackgroundManager,
    launch,
    getTask,
  }
}

describe("team-mode orchestrator", () => {
  test("#given Atlas team mode #when workers are launched #then each tmux pane runs a native Sisyphus OpenCode session without OMX worker bootstrap instructions", async () => {
    const { backgroundManager, launch } = createBackgroundManagerMock()

    const launched = await launchTeamWorkers(backgroundManager, {
      sessionID: "leader-session",
      parentMessageID: "msg-1",
      planName: "critical-fix",
      teamStatePath: "/tmp/team-state",
      workerIds: ["worker-1", "worker-2"],
      worktreePath: "/tmp/worktree",
    })

    expect(launch).toHaveBeenCalledTimes(2)
    expect(launched).toHaveLength(2)

    for (const call of launch.mock.calls) {
      expect(call[0]?.agent).toBe("sisyphus")
      expect(call[0]?.parentAgent).toBe("atlas")
      expect(call[0]?.parentSessionID).toBe("leader-session")
      expect(call[0]?.parentMessageID).toBe("msg-1")
      expect(call[0]?.forceTmuxPane).toBe(true)
      expect(call[0]?.strictTmuxAttach).toBe(true)
      expect(call[0]?.prompt).toContain("Worker ID:")
      expect(call[0]?.prompt).toContain("Plan: critical-fix")
      expect(call[0]?.prompt).toContain("Team state path: /tmp/team-state")
      expect(call[0]?.prompt).toContain("Work only inside: /tmp/worktree")
      expect(call[0]?.prompt).not.toContain("Atlas team-mode worker")
      expect(call[0]?.prompt).not.toContain("Use explicit claim and transition primitives")
      expect(call[0]?.prompt).not.toContain("Use mailbox state for leader-mediated coordination")
      expect(call[0]?.prompt).not.toContain("Update worker status before stopping")
      expect(call[0]?.prompt).not.toContain("OMX_TEAM_WORKER")
      expect(call[0]?.prompt).not.toContain("omx team api")
      expect(call[0]?.prompt).not.toContain("inbox")
    }
  })
})
