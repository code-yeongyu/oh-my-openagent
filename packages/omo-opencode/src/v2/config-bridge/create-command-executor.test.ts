import { describe, expect, it, mock } from "bun:test"
import type { V2CommandInvocation } from "../context-types"
import { createFakePluginContext } from "../fake-plugin-context"
import { createCommandExecutor, type BeforeCommandHook } from "./create-command-executor"

const invocation: V2CommandInvocation = { sessionID: "ses_1", prompt: { text: "fix the bug" }, delivery: "queue" }

describe("createCommandExecutor", () => {
  describe("#given a command template", () => {
    it("#when run without a before-hook #then the rendered template is prompted with the invocation's delivery", async () => {
      // given
      const fake = createFakePluginContext()
      const execute = createCommandExecutor({
        name: "triage",
        spec: { template: "Triage: $ARGUMENTS" },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook: undefined,
      })

      // when
      await execute(invocation)

      // then
      expect(fake.sessionCalls).toEqual([
        { kind: "prompt", input: { sessionID: "ses_1", text: "Triage: fix the bug", delivery: "queue" } },
      ])
    })

    it("#when a before-hook rewrites the parts #then the rewritten text is what gets prompted", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: unknown[] = []
      const beforeHook: BeforeCommandHook = async (input, output) => {
        seen.push(input)
        output.parts.push({ type: "text", text: "(extra context)" })
      }
      const execute = createCommandExecutor({
        name: "triage",
        spec: { template: "Triage: $ARGUMENTS" },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook,
      })

      // when
      await execute(invocation)

      // then
      expect(seen).toEqual([{ command: "triage", sessionID: "ses_1", arguments: "fix the bug" }])
      expect(fake.sessionCalls[0]).toEqual({
        kind: "prompt",
        input: { sessionID: "ses_1", text: "Triage: fix the bug\n(extra context)", delivery: "queue" },
      })
    })

    it("#when the before-hook leaves no text #then nothing is prompted", async () => {
      // given
      const fake = createFakePluginContext()
      const beforeHook: BeforeCommandHook = async (_input, output) => {
        output.parts.length = 0
      }
      const execute = createCommandExecutor({
        name: "stop-continuation",
        spec: { template: "stop" },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook,
      })

      // when
      await execute(invocation)

      // then
      expect(fake.sessionCalls).toEqual([])
    })

    it("#when the before-hook throws #then the error propagates so the host reports the command failure", async () => {
      // given
      const fake = createFakePluginContext()
      const failure = new Error("hook failed")
      const execute = createCommandExecutor({
        name: "triage",
        spec: { template: "x" },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook: mock(async () => {
          throw failure
        }),
      })

      // when
      const result = execute(invocation)

      // then
      await expect(result).rejects.toBe(failure)
      expect(fake.sessionCalls).toEqual([])
    })
  })

  describe("#given a command that names only an agent", () => {
    const atlas = {
      id: "Atlas - Plan Executor",
      name: "Atlas - Plan Executor",
      mode: "primary" as const,
      hidden: false,
      permissions: [],
      model: { providerID: "openai", id: "gpt-x" },
    }

    it("#when the session is on another agent #then it switches agent and takes that agent's model", async () => {
      // given
      const fake = createFakePluginContext({ agents: [atlas], sessionAgent: "Sisyphus" })
      const execute = createCommandExecutor({
        name: "start-work",
        spec: { template: "Go", agent: atlas.id },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook: undefined,
      })

      // when
      await execute(invocation)

      // then
      expect(fake.sessionCalls.map((call) => call.kind)).toEqual(["switchAgent", "switchModel", "prompt"])
      expect(fake.sessionCalls[1]).toMatchObject({ model: { providerID: "openai", id: "gpt-x" } })
    })

    it("#when the session is already on that agent #then it does not switch agent again", async () => {
      // given
      const fake = createFakePluginContext({ agents: [atlas], sessionAgent: atlas.id })
      const execute = createCommandExecutor({
        name: "start-work",
        spec: { template: "Go", agent: atlas.id },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook: undefined,
      })

      // when
      await execute(invocation)

      // then
      expect(fake.sessionCalls.map((call) => call.kind)).toEqual(["switchModel", "prompt"])
    })
  })

  describe("#given a command that names an agent and a model", () => {
    it("#when run #then the session is switched to them before the prompt", async () => {
      // given
      const fake = createFakePluginContext()
      const execute = createCommandExecutor({
        name: "start-work",
        spec: { template: "Go", agent: "Atlas - Plan Executor", model: "anthropic/claude-opus#high" },
        session: fake.context.session,
        agents: fake.context.agent,
        beforeHook: undefined,
      })

      // when
      await execute(invocation)

      // then
      expect(fake.sessionCalls.map((call) => call.kind)).toEqual(["switchAgent", "switchModel", "prompt"])
      expect(fake.sessionCalls[0]).toMatchObject({ agent: "Atlas - Plan Executor" })
      expect(fake.sessionCalls[1]).toMatchObject({ model: { providerID: "anthropic", id: "claude-opus", variant: "high" } })
    })
  })
})
