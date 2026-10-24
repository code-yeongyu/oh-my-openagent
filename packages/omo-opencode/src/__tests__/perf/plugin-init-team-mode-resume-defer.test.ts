import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, it } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { listActiveTeams } from "../../features/team-mode/team-state-store/store"
import { loadPluginConfig } from "../../plugin-config"

const HUNG_LEAD_SESSION_ID = "ses_999999999fffeeRegrTestHang0"
const SEEDED_TEAM_RUN_ID = "11111111-2222-4333-8444-555555555555"
// Circuit breaker only: a correct init settles on its own, so this never decides a passing run.
const INIT_CIRCUIT_BREAKER_MS = 30_000

// session.get answers with one deferred the test never resolves, so anything awaiting it can never settle.
function createHeldSessionGetClient(): PluginInput["client"] {
  const held = new Promise<unknown>(() => {})
  return unsafeTestValue<PluginInput["client"]>({
    session: {
      get: (..._unusedArgs: unknown[]): Promise<unknown> => held,
    },
  })
}

async function awaitInitOrTrip(initPromise: Promise<unknown>): Promise<"settled" | "tripped"> {
  let breaker: ReturnType<typeof setTimeout> | undefined
  const tripped = new Promise<"tripped">((resolve) => {
    breaker = setTimeout(() => resolve("tripped"), INIT_CIRCUIT_BREAKER_MS)
  })
  try {
    return await Promise.race([initPromise.then(() => "settled" as const), tripped])
  } finally {
    clearTimeout(breaker)
  }
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
  const teamRunId = SEEDED_TEAM_RUN_ID
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

// The loader reads the walked project layer `<project>/.omo/omo.json`; OPENCODE_CONFIG_DIR is no longer a config source.
function seedTeamModeConfig(projectDir: string, omoBaseDir: string): void {
  const configDir = join(projectDir, ".omo")
  mkdirSync(configDir, { recursive: true })
  const config = {
    "[opencode]": {
      team_mode: {
        enabled: true,
        tmux_visualization: false,
        base_dir: omoBaseDir,
      },
    },
  }
  writeFileSync(join(configDir, "omo.json"), JSON.stringify(config, null, 2))
}

describe("plugin init defers team-mode resume", () => {
  it("settles while session.get is held pending forever", async () => {
    // given a stale active team runtime that triggers resumeAllTeams -> session.get
    const rootDirectory = mkdtempSync(join(tmpdir(), "regr-team-defer-"))
    const projectDirectory = join(rootDirectory, "project")
    const configDirectory = join(rootDirectory, "opencode-config")
    const omoBaseDirectory = join(rootDirectory, "omo")
    const previousConfigDirectory = process.env.OPENCODE_CONFIG_DIR

    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(configDirectory, { recursive: true })
    seedTeamModeConfig(projectDirectory, omoBaseDirectory)
    seedStaleActiveRuntime(omoBaseDirectory)
    process.env.OPENCODE_CONFIG_DIR = configDirectory

    try {
      // the fixture must reach the resume path: team mode loads ON and the stale active run is listed
      const teamModeConfig = loadPluginConfig(projectDirectory, undefined).team_mode
      expect(teamModeConfig?.enabled).toBe(true)
      if (teamModeConfig === undefined) throw new Error("fixture did not load team_mode")
      const activeTeams = await listActiveTeams(teamModeConfig)
      expect(activeTeams.map((team) => [team.teamRunId, team.status])).toContainEqual([SEEDED_TEAM_RUN_ID, "active"])

      const pluginModule = await importFreshPluginModule()
      const input = createPluginInput(projectDirectory, createHeldSessionGetClient())

      // when serverPlugin runs while every session.get stays pending
      const outcome = await awaitInitOrTrip(pluginModule.server(input, {}))

      // then init settled on its own although session.get never answers, so it did not await the resume
      if (outcome === "tripped") {
        throw new Error(
          `plugin init did not settle within the ${INIT_CIRCUIT_BREAKER_MS}ms circuit breaker while session.get was held pending: init awaits the team-mode resume`,
        )
      }
      expect(outcome).toBe("settled")
    } finally {
      if (previousConfigDirectory === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDirectory
      }
      rmSync(rootDirectory, { recursive: true, force: true })
    }
  }, INIT_CIRCUIT_BREAKER_MS * 2)
})
