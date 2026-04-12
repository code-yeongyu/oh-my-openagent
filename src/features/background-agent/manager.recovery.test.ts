import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask } from "./types"
import { BackgroundManager } from "./manager"

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

function createBackgroundLaunchOutput(taskID: string, description: string, sessionID: string): string {
  return `Background task launched.

Background Task ID: ${taskID}
Description: ${description}
Agent: Sisyphus-Junior (category: quick)
Status: pending

System notifies on completion. Use \`background_output\` with task_id="${taskID}" to check.

<task_metadata>
session_id: ${sessionID}
task_id: ${taskID}
background_task_id: ${taskID}
</task_metadata>

to continue: task(session_id="${sessionID}", prompt="...")`
}

describe("BackgroundManager orphan recovery", () => {
  const originalDataDir = process.env.XDG_DATA_HOME
  let testDataDir = ""

  beforeEach(() => {
    testDataDir = join(tmpdir(), `omo-orphan-recovery-${randomUUID()}`)
    process.env.XDG_DATA_HOME = testDataDir
  })

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalDataDir
    }
    rmSync(testDataDir, { recursive: true, force: true })
  })

  test("recovers completed orphan background tasks from sqlite and notifies the parent session", async () => {
    //#given
    const dbDir = join(testDataDir, "opencode")
    mkdirSync(dbDir, { recursive: true })
    const dbPath = join(dbDir, "opencode.db")
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `)

    const parentSessionID = "ses-parent"
    const now = Date.now()

    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "part-launch-1",
      "msg-parent",
      parentSessionID,
      now - 4000,
      now - 4000,
      JSON.stringify({
        type: "tool",
        tool: "task",
        state: {
          input: {
            description: "Query intel_topics via SSH",
            subagent_type: "Sisyphus-Junior",
            category: "quick",
            run_in_background: true,
          },
          output: createBackgroundLaunchOutput(
            "bg_2d6b2eca",
            "Query intel_topics via SSH",
            "ses-child-1",
          ),
          metadata: {
            sessionId: "ses-child-1",
            agent: "Sisyphus-Junior",
          },
        },
      }),
    )

    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "part-launch-2",
      "msg-parent",
      parentSessionID,
      now - 3000,
      now - 3000,
      JSON.stringify({
        type: "tool",
        tool: "task",
        state: {
          input: {
            description: "Check hermes intel CLI help",
            subagent_type: "Sisyphus-Junior",
            category: "quick",
            run_in_background: true,
          },
          output: createBackgroundLaunchOutput(
            "bg_4f28dbef",
            "Check hermes intel CLI help",
            "ses-child-2",
          ),
          metadata: {
            sessionId: "ses-child-2",
            agent: "Sisyphus-Junior",
          },
        },
      }),
    )
    db.close()

    const promptAsyncCalls: Array<{ sessionID: string; text: string; noReply?: boolean }> = []
    const childMessages = {
      "ses-child-1": {
        data: [
          {
            info: {
              role: "assistant",
              finish: "tool-calls",
              time: { created: now - 3900, completed: now - 3200 },
            },
            parts: [{ type: "reasoning", text: "psql failed because the column does not exist" }],
          },
          {
            info: {
              role: "assistant",
              time: { created: now - 3100 },
            },
            parts: [],
          },
        ],
      },
      "ses-child-2": {
        data: [
          {
            info: {
              role: "assistant",
              finish: "tool-calls",
              time: { created: now - 2900, completed: now - 2200 },
            },
            parts: [{ type: "reasoning", text: "CLI help command completed successfully" }],
          },
          {
            info: {
              role: "assistant",
              time: { created: now - 2100 },
            },
            parts: [
              { type: "step-start" },
              { type: "text", text: "" },
            ],
          },
        ],
      },
    } as const

    const manager = new BackgroundManager({
      client: {
        session: {
          prompt: async () => ({}),
          promptAsync: async (input: { path: { id: string }; body: { noReply?: boolean; parts: Array<{ text?: string }> } }) => {
            promptAsyncCalls.push({
              sessionID: input.path.id,
              text: input.body.parts[0]?.text ?? "",
              noReply: input.body.noReply,
            })
            return {}
          },
          abort: async () => ({}),
          todo: async () => ({ data: [] }),
          messages: async (input: { path: { id: string } }) => {
            if (input.path.id === "ses-child-1") return childMessages["ses-child-1"]
            if (input.path.id === "ses-child-2") return childMessages["ses-child-2"]
            return { data: [] }
          },
        },
      },
      directory: tmpdir(),
    } as unknown as PluginInput)

    //#when
    await manager.recoverOrphanedTasks()

    //#then
    expect(getTaskMap(manager).get("bg_2d6b2eca")?.status).toBe("completed")
    expect(getTaskMap(manager).get("bg_4f28dbef")?.status).toBe("completed")
    expect(promptAsyncCalls).toHaveLength(2)
    expect(promptAsyncCalls[0]?.sessionID).toBe(parentSessionID)
    expect(promptAsyncCalls[0]?.text).toContain("bg_2d6b2eca")
    expect(promptAsyncCalls[0]?.noReply).toBe(true)
    expect(promptAsyncCalls[1]?.sessionID).toBe(parentSessionID)
    expect(promptAsyncCalls[1]?.text).toContain("<system-reminder>")
    expect(promptAsyncCalls[1]?.text).toContain("Background tasks complete.")
    expect(promptAsyncCalls[1]?.text).toContain("bg_2d6b2eca")
    expect(promptAsyncCalls[1]?.text).toContain("bg_4f28dbef")
    expect(promptAsyncCalls[1]?.noReply).toBe(true)

    manager.shutdown()
  })
})
