import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { executeBackgroundTask } from "./background-task"
import { executeUnstableAgentTask } from "./unstable-agent-task"
import { createDelegateTask } from "./tools"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

const parentContext = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
}

function createToolContext(): ToolContextWithMetadata {
  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: async () => {},
  }
}

describe("background task description redaction", () => {
  test("#given task tool omits description #when launching in background #then generated prompt summary is not persisted", async () => {
    // given
    let launchedDescription = ""
    const tool = createDelegateTask(unsafeTestValue({
      directory: "/tmp/project",
      connectedProvidersOverride: ["openai"],
      availableModelsOverride: new Set(["openai/gpt-5.4-mini"]),
      manager: {
        launch: async (input: { readonly description: string; readonly agent: string }) => {
          launchedDescription = input.description
          return {
            id: "bg_tool_secret",
            sessionId: "ses_tool_secret",
            description: input.description,
            agent: input.agent,
            status: "running",
          }
        },
        getTask: () => undefined,
      },
      client: {
        app: { agents: async () => ({ data: [] }) },
        config: { get: async () => ({ data: { model: "openai/gpt-5.4-mini" } }) },
        session: {
          create: async () => ({ data: { id: "ses_tool_secret" } }),
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
      },
    }))

    // when
    await tool.execute(
      {
        prompt: "SECRET_TOKEN=never-write-this inspect the repo",
        category: "quick",
        run_in_background: true,
        load_skills: [],
      },
      unsafeTestValue(createToolContext()),
    )

    // then
    expect(launchedDescription).toBe("Sisyphus-Junior background task")
    expect(launchedDescription).not.toContain("SECRET_TOKEN")
  })

  test("#given generated description contains prompt text #when launching background task #then persisted task description is agent-only", async () => {
    // given
    let launchedDescription = ""
    const args = unsafeTestValue<DelegateTaskArgs>({
      description: "SECRET_TOKEN=never-write-this do work",
      descriptionSource: "generated",
      prompt: "SECRET_TOKEN=never-write-this do work",
      run_in_background: true,
      load_skills: [],
      subagent_type: "atlas",
    })

    // when
    await executeBackgroundTask(
      args,
      createToolContext(),
      unsafeTestValue({
        manager: {
          launch: async (input: { readonly description: string; readonly agent: string }) => {
            launchedDescription = input.description
            return {
              id: "bg_secret",
              sessionId: "ses_secret",
              description: input.description,
              agent: input.agent,
              status: "running",
            }
          },
          getTask: () => undefined,
        },
      }),
      parentContext,
      "atlas",
      undefined,
      undefined,
    )

    // then
    expect(launchedDescription).toBe("Atlas - Plan Executor background task")
    expect(launchedDescription).not.toContain("SECRET_TOKEN")
  })

  test("#given generated description contains prompt text #when unstable task is forced into background #then persisted task description is agent-only", async () => {
    // given
    let launchedDescription = ""
    const args = unsafeTestValue<DelegateTaskArgs>({
      description: "SECRET_TOKEN=never-write-this investigate",
      descriptionSource: "generated",
      prompt: "SECRET_TOKEN=never-write-this investigate",
      category: "quick",
      run_in_background: false,
      load_skills: [],
    })

    // when
    await executeUnstableAgentTask(
      args,
      createToolContext(),
      unsafeTestValue({
        manager: {
          launch: async (input: { readonly description: string; readonly agent: string }) => {
            launchedDescription = input.description
            return {
              id: "bg_unstable_secret",
              sessionId: "ses_unstable_secret",
              description: input.description,
              agent: input.agent,
              status: "running",
            }
          },
          getTask: () => ({
            id: "bg_unstable_secret",
            sessionId: "ses_unstable_secret",
            description: launchedDescription,
            agent: "sisyphus-junior",
            status: "completed",
          }),
        },
        client: {
          session: {
            status: async () => ({ data: { ses_unstable_secret: { type: "idle" } } }),
            messages: async () => ({
              data: [{
                info: { role: "assistant", time: { created: 1 } },
                parts: [{ type: "text", text: "done" }],
              }],
            }),
          },
        },
        syncPollTimeoutMs: 100,
      }),
      parentContext,
      "sisyphus-junior",
      undefined,
      undefined,
      "test-model",
    )

    // then
    expect(launchedDescription).toBe("sisyphus-junior background task")
    expect(launchedDescription).not.toContain("SECRET_TOKEN")
  })
})
