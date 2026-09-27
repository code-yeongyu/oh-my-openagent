import { afterEach, describe, expect, test } from "bun:test"
import { clearSessionAgent, updateSessionAgent } from "../features/claude-code-session-state"
import { PROMETHEUS_BASH_REFUSAL } from "./prometheus-bash-guard"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"

const SESSION_ID = "ses_prometheus_bash_guard"

function createHandler(agentOverrides?: Record<string, { displayName?: string }>) {
  return createToolExecuteBeforeHandler({
    ctx: {
      directory: "/tmp/prometheus-bash-guard-test",
      client: { session: { messages: async () => ({ data: [] }) } },
    } as never,
    hooks: {} as never,
    agentOverrides,
  })
}

function runBash(handler: ReturnType<typeof createHandler>, tool: string, command: string) {
  return handler({ tool, sessionID: SESSION_ID, callID: "call_bash" }, { args: { command } })
}

describe("tool.execute.before Prometheus bash guard", () => {
  afterEach(() => {
    clearSessionAgent(SESSION_ID)
  })

  test("#given a Prometheus session with no hooks enabled #when it calls bash #then the call is refused before it runs", async () => {
    // given
    updateSessionAgent(SESSION_ID, "Prometheus - Plan Builder")
    const handler = createHandler()

    // when / then
    for (const [tool, command] of [["bash", "git status"], ["Bash", "> proof.txt"], ["mcp_bash", "cd ."]]) {
      await expect(runBash(handler, tool, command)).rejects.toThrow(PROMETHEUS_BASH_REFUSAL)
    }
  })

  test("#given Prometheus renamed through displayName #when it calls bash #then the call is refused", async () => {
    // given
    updateSessionAgent(SESSION_ID, "Planner")
    const handler = createHandler({ prometheus: { displayName: "Planner" } })

    // when
    const run = runBash(handler, "bash", "ls")

    // then
    await expect(run).rejects.toThrow(PROMETHEUS_BASH_REFUSAL)
  })

  test.each([["Sisyphus - Ultraworker"], ["Hephaestus - Deep Agent"], ["Planner"]])(
    "#given a %s session without a Prometheus rename #when it calls bash #then the call goes through",
    async (agent) => {
      // given
      updateSessionAgent(SESSION_ID, agent)
      const handler = createHandler()

      // when
      const run = runBash(handler, "bash", "ls")

      // then
      await expect(run).resolves.toBeUndefined()
    },
  )

  test("#given a Prometheus session #when it calls a non-shell tool #then the guard does not interfere", async () => {
    // given
    updateSessionAgent(SESSION_ID, "Prometheus - Plan Builder")
    const handler = createHandler()

    // when
    const run = handler({ tool: "read", sessionID: SESSION_ID, callID: "call_read" }, { args: { filePath: "/tmp/a" } })

    // then
    await expect(run).resolves.toBeUndefined()
  })
})
