import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createProcessIsolationComponent } from "./index"
import * as runtime from "./runtime"
import { ISOLATION_ENV, SCOPE_ENV } from "./runtime"

const SESSION_CONTEXT = { sessionManager: { getSessionId: () => "session-a" } }

const loadRuntime = async () => runtime

function createContext(): ComponentContext {
  return {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    config: { getFlag: () => undefined },
  }
}

async function register(options: Parameters<typeof createProcessIsolationComponent>[0] = {}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  await createProcessIsolationComponent({ loadRuntime, ...options }).register(pi, createContext())
  return pi
}

describe("createProcessIsolationComponent()", () => {
  test("#given a normal command #when the tool call runs #then the command is scoped for its descendants", async () => {
    const pi = await register({ env: {} })
    const payload = { toolName: "bash", input: { command: "npx playwright test" } }

    await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(payload.input.command).toBe(`export ${SCOPE_ENV}='omo:session-a'\nnpx playwright test`)
  })

  test("#given a foreign pid kill #when the tool call runs #then it is blocked and left untouched", async () => {
    const pi = await register({
      env: {},
      loadRuntime: async () => ({
        ...runtime,
        processIsolationVerdict: async () => "pid 100 belongs to another OmO session",
      }),
    })
    const payload = { toolName: "bash", input: { command: "kill -9 100" } }

    const [result] = await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("pid 100") })
    expect(payload.input.command).toBe("kill -9 100")
  })

  test("#given OMO_PROCESS_ISOLATION=off in the environment #when the tool call runs #then the command is untouched", async () => {
    const pi = await register({ env: { [ISOLATION_ENV]: "off" } })
    const payload = { toolName: "bash", input: { command: "kill -9 100" } }

    const [result] = await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(result).toBeUndefined()
    expect(payload.input.command).toBe("kill -9 100")
  })

  test("#given the command opts out inline #when the tool call runs #then no scope is injected", async () => {
    const pi = await register({ env: {} })
    const payload = { toolName: "bash", input: { command: "OMO_PROCESS_ISOLATION=off pkill node" } }

    await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(payload.input.command).toBe("OMO_PROCESS_ISOLATION=off pkill node")
  })

  test("#given no session id #when the tool call runs #then the component fails open without a scope", async () => {
    const pi = await register({ env: {} })
    const payload = { toolName: "bash", input: { command: "kill -9 100" } }

    const [result] = await pi.dispatch("tool_call", payload, {})

    expect(result).toBeUndefined()
    expect(payload.input.command).toBe("kill -9 100")
  })

  test("#given a non-bash tool #when the tool call runs #then it is ignored", async () => {
    const pi = await register({ env: {} })
    const payload = { toolName: "read", input: { command: "kill -9 100" } }

    const [result] = await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(result).toBeUndefined()
    expect(payload.input.command).toBe("kill -9 100")
  })

  test("#given the guard throws #when the tool call runs #then the command is allowed and scoped", async () => {
    const pi = await register({
      env: {},
      loadRuntime: async () => ({
        ...runtime,
        processIsolationVerdict: async () => {
          throw new Error("ps failed")
        },
      }),
    })
    const payload = { toolName: "bash", input: { command: "pkill -f playwright" } }

    const [result] = await pi.dispatch("tool_call", payload, SESSION_CONTEXT)

    expect(result).toBeUndefined()
    expect(payload.input.command).toBe(`export ${SCOPE_ENV}='omo:session-a'\npkill -f playwright`)
  })

  test("#given the sidecar fails to load #when the component registers #then it stays inert", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    const context: ComponentContext = {
      logger: {
        info: () => undefined,
        warn: (message: string, details?: unknown) => warnings.push([message, details]),
        error: () => undefined,
      },
      config: { getFlag: () => undefined },
    }
    await createProcessIsolationComponent({
      loadRuntime: async () => {
        throw new Error("sidecar missing")
      },
    }).register(pi, context)

    expect(pi.handlers).toHaveLength(0)
    expect(warnings).toHaveLength(1)
  })
})
