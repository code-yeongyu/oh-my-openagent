import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, it } from "bun:test"

const HUNG_LEAD_SESSION_ID = "ses_999999999fffeeRegrTestHang0"

function makeHangingClient(): {
  hangCount: { value: number }
  client: PluginInput["client"]
} {
  const hangCount = { value: 0 }
  const sessionGet = (..._unusedArgs: unknown[]): Promise<unknown> => {
    hangCount.value += 1
    return new Promise<never>(() => {})
  }
  const client = {
    session: {
      get: sessionGet,
    },
  } as unknown as PluginInput["client"]
  return { hangCount, client }
}

function createPluginInput(directory: string, client: PluginInput["client"]): PluginInput {
  return {
    client,
    project: {
      id: `regr-${Date.now()}`,
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost"),
    $: Bun.$,
  }
}

async function importFreshPluginModule(): Promise<(typeof import("../../index"))["default"]> {
  const token = `${Date.now()}-${Math.random()}`
  return (await import(`../../index?regr=${token}`)).default
}

function seedStaleActiveRuntime(omoBaseDir: string): void {
  const teamRunId = "11111111-2222-3333-4444-555555555555"
  const runtimeDir = join(omoBaseDir, "runtime", teamRunId)
  mkdirSync(runtimeDir, { recursive: true })
  const runtimeState = {
    version: 1,
    teamRunId,
    teamName: "regression-stale-active",
    specSource: "user",
    createdAt: Date.now(),
    status: "active",
    leadSessionId: HUNG_LEAD_SESSION_ID,
    members: [
      {
        name: "lead",
        sessionId: HUNG_LEAD_SESSION_ID,
        agentType: "leader",
        status: "running",
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
  writeFileSync(join(runtimeDir, "state.json"), `${JSON.stringify(runtimeState, null, 2)}\n`)
}

function seedTeamModeConfig(configDir: string, omoBaseDir: string): void {
  mkdirSync(configDir, { recursive: true })
  const config = {
    team_mode: {
      enabled: true,
      tmux_visualization: false,
      base_dir: omoBaseDir,
    },
  }
  writeFileSync(join(configDir, "oh-my-openagent.json"), JSON.stringify(config, null, 2))
}

describe("plugin init defers team-mode resume", () => {
  it("returns within budget even when session.get hangs forever", async () => {
    // given a stale active team runtime that triggers resumeAllTeams -> session.get
    const rootDirectory = mkdtempSync(join(tmpdir(), "regr-team-defer-"))
    const projectDirectory = join(rootDirectory, "project")
    const configDirectory = join(rootDirectory, "opencode-config")
    const omoBaseDirectory = join(rootDirectory, "omo")
    const previousConfigDirectory = process.env.OPENCODE_CONFIG_DIR

    mkdirSync(projectDirectory, { recursive: true })
    seedTeamModeConfig(configDirectory, omoBaseDirectory)
    seedStaleActiveRuntime(omoBaseDirectory)
    process.env.OPENCODE_CONFIG_DIR = configDirectory

    try {
      const pluginModule = await importFreshPluginModule()
      const { hangCount, client } = makeHangingClient()
      const input = createPluginInput(projectDirectory, client)

      // when serverPlugin is called with a hanging session.get
      const start = performance.now()
      const initPromise = pluginModule.server(input, {})
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        globalThis.setTimeout(() => resolve("timeout"), 3000)
      })
      const result = await Promise.race([initPromise, timeoutPromise])
      const elapsedMs = performance.now() - start

      // then plugin init completes; resume call (if it fired) is a deferred no-op against the hang
      expect(result).not.toBe("timeout")
      expect(elapsedMs).toBeLessThan(2000)
      expect(hangCount.value).toBe(0)
    } finally {
      if (previousConfigDirectory === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDirectory
      }
      rmSync(rootDirectory, { recursive: true, force: true })
    }
  })
})
