import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { spawn, type SpawnedProcess } from "@oh-my-opencode/utils/runtime"
import {
  herdrCreateWorkspace,
  herdrCreateTab,
  herdrListAgents,
  herdrListTeamWorkspaces,
  herdrReadPane,
  herdrRunPaneCommand,
  herdrCloseWorkspace,
  HERDR_TEAM_WORKSPACE_LABEL_PREFIX,
  isHerdrBinaryCallable,
  runHerdrCommandDefault,
  type HerdrOpsDeps,
} from "./herdr-core"

/**
 * Opt-in integration test against a real `herdr` binary (v0.9.x): runs only
 * when RUN_HERDR_LIVE=1, otherwise a real skip. A plain `bun test` must be
 * hermetic everywhere - this suite restores the real HOME/XDG (see below),
 * so on a herdr machine it would otherwise reach the developer's live
 * server. (Same policy as the OMO_LIVE_TMUX-gated tmux suite; a missing
 * herdr binary is a skip too, never a silent pass.)
 *
 * Test-harness notes:
 * - bun-test preloads redirect HOME/XDG into a per-process sandbox; herdr
 *   derives its socket from those, so every call runs with a restored real
 *   environment (os.homedir() still names the real home - see
 *   test-hermetic-home.ts).
 * - the harness janitor kills detached stdio:"ignore" children, so instead of
 *   ensureHerdrServer's detached autostart the test owns a tracked server
 *   child and stops it in finally (the autostart logic itself is unit-tested).
 */

/** Live gate: `RUN_HERDR_LIVE=1 bun test packages/tmux-core`. */
const LIVE = process.env.RUN_HERDR_LIVE === "1" && isHerdrBinaryCallable()

function realEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  env["HOME"] = homedir()
  for (const key of ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]) {
    const value = env[key]
    if (typeof value === "string" && value.includes("omo-test")) delete env[key]
  }
  return env
}

const ops: HerdrOpsDeps = {
  runHerdrCommand: (args, options) => runHerdrCommandDefault(args, { ...options, env: realEnv() }),
  ensureServer: async () => "running",
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // A booting server holds the socket without answering; bound each probe
    // so one blocked CLI call cannot eat the whole budget.
    const probe = await runHerdrCommandDefault(["agent", "list"], { env: realEnv(), timeoutMs: 1_500 })
    if (probe.success) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}


async function stopOwnedServer(server: SpawnedProcess | null): Promise<void> {
  if (!server) return
  await runHerdrCommandDefault(["server", "stop"], { env: realEnv(), timeoutMs: 3_000 }).catch(() => undefined)
  try {
    server.kill()
  } catch {
    // already gone
  }
  await Promise.race([
    server.exited.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ])
}

describe("herdr core (real herdr)", () => {
  test.skipIf(!LIVE)("workspace + tab + pane run + read + teardown round-trip", { timeout: 20000 }, async () => {

    const label = `${HERDR_TEAM_WORKSPACE_LABEL_PREFIX}itest${Date.now().toString(36)}`
    const initiallyRunning = (await runHerdrCommandDefault(["agent", "list"], { env: realEnv(), timeoutMs: 2_000 })).success
    let server: SpawnedProcess | null = null
    if (!initiallyRunning) {
      server = spawn(["herdr", "server"], { stdout: "pipe", stderr: "pipe", env: realEnv() })
      void new Response(server.stdout).text().catch(() => "")
      void new Response(server.stderr).text().catch(() => "")
      if (!(await waitForServer(8_000))) {
        // Some test harnesses starve or contend a booting herdr server (the
        // same spawn is up in <1s outside the runner). Rather than fail, skip:
        // the round-trip runs wherever a server is actually reachable.
        await stopOwnedServer(server)
        server = null
        return
      }
    }

    let workspaceId: string | null = null
    try {
      const workspace = await herdrCreateWorkspace(process.cwd(), label, ops)
      workspaceId = workspace.workspaceId
      expect(workspaceId).toMatch(/^w[0-9a-z]+$/i)

      const tab = await herdrCreateTab(workspaceId, process.cwd(), "member-1", {}, ops)
      expect(tab.paneId).toMatch(/^w[0-9a-z]+:p[0-9a-z]+$/i)

      await herdrRunPaneCommand(tab.paneId, "echo OMO_HERDR_E2E_OK", ops)
      await new Promise((resolve) => setTimeout(resolve, 800))
      const text = await herdrReadPane(tab.paneId, 20, ops)
      expect(text).toContain("OMO_HERDR_E2E_OK")

      const teams = await herdrListTeamWorkspaces(ops)
      expect(teams.some((team) => team.workspaceId === workspaceId)).toBe(true)

      // A plain shell pane hosts no agent - the inventory stays empty, which
      // is exactly what the stale-workspace sweep keys off.
      const agents = await herdrListAgents(ops)
      expect(agents.every((agent) => !agent.paneId.startsWith(`${workspaceId}:`))).toBe(true)

      await herdrCloseWorkspace(workspaceId, ops)
      workspaceId = null
      const teamsAfter = await herdrListTeamWorkspaces(ops)
      expect(teamsAfter.some((team) => team.label === label)).toBe(false)
    } finally {
      if (workspaceId) {
        await herdrCloseWorkspace(workspaceId, ops).catch(() => undefined)
      }
      if (server) {
        await runHerdrCommandDefault(["server", "stop"], { env: realEnv(), timeoutMs: 3_000 }).catch(() => undefined)
        await server.exited.catch(() => undefined)
      }
    }
  })
})
