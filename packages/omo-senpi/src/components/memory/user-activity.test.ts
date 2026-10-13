import { expect, test } from "bun:test"
import { MemoryFakeExtensionAPI } from "./memory.test-support"
import { createMemoryUserActivity } from "./user-activity"

const SESSION = "activity-session"
const eventCtx = { sessionManager: { getSessionId: () => SESSION } }

test.each(["child", "dag_child", "member", "dream_child"])(
  "#given a %s session role #when its RPC input is accepted #then it cannot grant automatic memory activity",
  async (role) => {
    const pi = Object.assign(new MemoryFakeExtensionAPI(), { sessionContext: { role } })
    const activity = createMemoryUserActivity({})
    activity.register(pi)

    await pi.dispatch("input", { source: "rpc", inputId: "task-input", text: "Perform the task." }, eventCtx)
    await pi.dispatch("input_disposition", { inputId: "task-input", disposition: "started" }, eventCtx)

    expect(activity.has(SESSION)).toBe(false)
    expect(activity.hasInput(SESSION)).toBe(false)
  },
)

test.each([
  { OMO_SENPI_TASK_RPC_CHILD: "1" },
  { SENPI_TASK_MEMBER: "run::worker" },
])("#given a per-child process environment %j #when its input is accepted #then automatic memory activity stays disabled", async (env) => {
  const pi = new MemoryFakeExtensionAPI()
  const activity = createMemoryUserActivity(env)
  activity.register(pi)

  await pi.dispatch("input", { source: "interactive", inputId: "task-input", text: "Perform the task." }, eventCtx)
  await pi.dispatch("input_disposition", { inputId: "task-input", disposition: "queued" }, eventCtx)

  expect(activity.has(SESSION)).toBe(false)
  expect(activity.hasInput(SESSION)).toBe(false)
})

test("#given an ordinary top-level RPC input #when the engine reaches before_agent_start #then prompt-time memory can observe it before disposition", async () => {
  const pi = new MemoryFakeExtensionAPI()
  const activity = createMemoryUserActivity({})
  activity.register(pi)

  await pi.dispatch("input", { source: "rpc", inputId: "user-input", text: "Remember this." }, eventCtx)

  expect(activity.hasInput(SESSION)).toBe(true)
  expect(activity.has(SESSION)).toBe(false)
})

test("#given an ordinary top-level RPC input #when the engine accepts it #then automatic memory activity remains enabled after disposition", async () => {
  const pi = new MemoryFakeExtensionAPI()
  const activity = createMemoryUserActivity({})
  activity.register(pi)

  await pi.dispatch("input", { source: "rpc", inputId: "user-input", text: "Remember this." }, eventCtx)
  await pi.dispatch("input_disposition", { inputId: "user-input", disposition: "started" }, eventCtx)

  expect(activity.has(SESSION)).toBe(true)
  expect(activity.hasInput(SESSION)).toBe(true)
})

test("#given a tracked top-level input #when the engine handles it without a turn #then prompt-time memory admission is revoked", async () => {
  const pi = new MemoryFakeExtensionAPI()
  const activity = createMemoryUserActivity({})
  activity.register(pi)

  await pi.dispatch("input", { source: "rpc", inputId: "user-input", text: "Remember this." }, eventCtx)
  await pi.dispatch("input_disposition", { inputId: "user-input", disposition: "handled" }, eventCtx)

  expect(activity.has(SESSION)).toBe(false)
  expect(activity.hasInput(SESSION)).toBe(false)
})
