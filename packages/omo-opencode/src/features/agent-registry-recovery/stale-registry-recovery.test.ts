import { beforeEach, describe, expect, test } from "bun:test"

import { registerAgentName } from "../claude-code-session-state"
import { _resetForTesting, recordAppliedRegistry } from "./registry-snapshot"
import {
  createStaleAgentRegistryRecovery,
  DEFAULT_RECOVERY_COOLDOWN_MS,
} from "./stale-registry-recovery"

type FakeClientCalls = { agents: number; dispose: number }

function createFakeClient(params: {
  liveNames?: string[]
  agentsError?: Error
  disposeError?: Error
}) {
  const calls: FakeClientCalls = { agents: 0, dispose: 0 }
  return {
    calls,
    client: {
      app: {
        agents: async (): Promise<unknown> => {
          calls.agents++
          if (params.agentsError) throw params.agentsError
          return {
            data: (params.liveNames ?? []).map((name) => ({ name })),
          }
        },
      },
      instance: {
        dispose: async (): Promise<unknown> => {
          calls.dispose++
          if (params.disposeError) throw params.disposeError
          return { data: true }
        },
      },
    },
  }
}

describe("createStaleAgentRegistryRecovery", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("#given no recorded snapshot #when maybeRecover runs #then no client call happens", async () => {
    const { client, calls } = createFakeClient({ liveNames: [] })
    const recovery = createStaleAgentRegistryRecovery({ client })

    const recovered = await recovery.maybeRecover()

    expect(recovered).toBe(false)
    expect(calls.agents).toBe(0)
    expect(calls.dispose).toBe(0)
  })

  test("#given applied names visible in the live registry #when maybeRecover runs #then the instance is not disposed", async () => {
    registerAgentName("sisyphus")
    recordAppliedRegistry(["sisyphus"])
    const { client, calls } = createFakeClient({ liveNames: ["build", "plan", "sisyphus"] })
    const recovery = createStaleAgentRegistryRecovery({ client })

    const recovered = await recovery.maybeRecover()

    expect(recovered).toBe(false)
    expect(calls.dispose).toBe(0)
  })

  test("#given applied names missing from the live registry #when maybeRecover runs #then the instance is disposed once", async () => {
    registerAgentName("sisyphus")
    registerAgentName("atlas")
    recordAppliedRegistry(["sisyphus", "atlas"])
    const { client, calls } = createFakeClient({ liveNames: ["build", "plan"] })
    const recovery = createStaleAgentRegistryRecovery({ client })

    const recovered = await recovery.maybeRecover()

    expect(recovered).toBe(true)
    expect(calls.dispose).toBe(1)
  })

  test("#given a recovery just happened #when maybeRecover runs again within the cooldown #then the instance is not disposed twice", async () => {
    let now = 1_000_000
    registerAgentName("sisyphus")
    recordAppliedRegistry(["sisyphus"])
    const { client, calls } = createFakeClient({ liveNames: ["build", "plan"] })
    const recovery = createStaleAgentRegistryRecovery({ client, now: () => now })

    await recovery.maybeRecover()
    now += DEFAULT_RECOVERY_COOLDOWN_MS - 1
    const recoveredAgain = await recovery.maybeRecover()

    expect(recoveredAgain).toBe(false)
    expect(calls.dispose).toBe(1)
  })

  test("#given a cooldown expired #when maybeRecover runs on a still-stale registry #then the instance is disposed again", async () => {
    let now = 1_000_000
    registerAgentName("sisyphus")
    recordAppliedRegistry(["sisyphus"])
    const { client, calls } = createFakeClient({ liveNames: ["build", "plan"] })
    const recovery = createStaleAgentRegistryRecovery({ client, now: () => now })

    await recovery.maybeRecover()
    now += DEFAULT_RECOVERY_COOLDOWN_MS + 1
    const recoveredAgain = await recovery.maybeRecover()

    expect(recoveredAgain).toBe(true)
    expect(calls.dispose).toBe(2)
  })

  test("#given dispose fails #when maybeRecover runs #then the error is swallowed and cooldown is still marked", async () => {
    let now = 1_000_000
    registerAgentName("sisyphus")
    recordAppliedRegistry(["sisyphus"])
    const { client, calls } = createFakeClient({
      liveNames: ["build"],
      disposeError: new Error("dispose endpoint unavailable"),
    })
    const recovery = createStaleAgentRegistryRecovery({ client, now: () => now })

    const recovered = await recovery.maybeRecover()
    now += DEFAULT_RECOVERY_COOLDOWN_MS - 1
    const withinCooldown = await recovery.maybeRecover()

    expect(recovered).toBe(false)
    expect(withinCooldown).toBe(false)
    expect(calls.dispose).toBe(1)
  })

  test("#given the live agent query fails #when maybeRecover runs #then no dispose is attempted and no error escapes", async () => {
    registerAgentName("sisyphus")
    recordAppliedRegistry(["sisyphus"])
    const { client, calls } = createFakeClient({ agentsError: new Error("server unreachable") })
    const recovery = createStaleAgentRegistryRecovery({ client })

    const recovered = await recovery.maybeRecover()

    expect(recovered).toBe(false)
    expect(calls.dispose).toBe(0)
  })
})
