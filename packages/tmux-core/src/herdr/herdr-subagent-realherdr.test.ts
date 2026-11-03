import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { spawn, type SpawnedProcess } from "@oh-my-opencode/utils/runtime"
import {
  herdrClosePaneIfExists,
  herdrCloseWorkspace,
  herdrListWorkspacesByLabelPrefix,
  herdrReadPane,
  runHerdrCommandDefault,
  HERDR_AGENTS_WORKSPACE_LABEL_PREFIX,
  type HerdrOpsDeps,
} from "./herdr-core"
import { getHerdrAgentsWorkspaceLabel, spawnHerdrSubagentTab, sweepStaleHerdrAgentsWorkspaces } from "./herdr-subagent"

/**
 * Live round-trip for the herdr subagent primitives against a real `herdr`
 * binary (v0.9.x), self-skipping when herdr is not installed. Same harness
 * rules as herdr-core-realherdr.test.ts: restored real HOME/XDG (bun-test
 * preloads sandbox them; herdr derives its socket from them), a tracked
 * server child instead of detached autostart, and bounded probe timeouts
 * because a booting server holds the socket without answering.
 *
 * The attach command targets a dead port on purpose: this pins delivery
 * (the command line reaches the pane) without needing a real opencode
 * server.
 */
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

/** A pid far beyond any pid_max — dead by construction for the sweep arm. */
const DEAD_MANAGER_PID = 4_194_304

describe("herdr subagent (real herdr)", () => {
  test("spawn delivers the attach command into a real tab; dead panes report gone; the sweep closes dead-manager workspaces", { timeout: 20000 }, async () => {
    if (!(await runHerdrCommandDefault(["--version"], { env: realEnv(), timeoutMs: 3_000 })).success) return // skip: herdr not installed

    let server: SpawnedProcess | null = null
    if (!(await runHerdrCommandDefault(["agent", "list"], { env: realEnv(), timeoutMs: 2_000 })).success) {
      server = spawn(["herdr", "server"], { stdout: "pipe", stderr: "pipe", env: realEnv() })
      void new Response(server.stdout).text().catch(() => "")
      void new Response(server.stderr).text().catch(() => "")
      if (!(await waitForServer(8_000))) {
        // Boot contention rather than a product failure — skip like the core suite does.
        await stopOwnedServer(server)
        return
      }
    }

    // workspace of the live test manager (current pid — the sweep must skip it)
    const liveLabel = getHerdrAgentsWorkspaceLabel(process.pid, `${Date.now().toString(36)}t`)
    let liveWorkspaceId: string | null = null
    // workspace of a provably dead manager pid — the sweep must close it
    const deadLabel = `${HERDR_AGENTS_WORKSPACE_LABEL_PREFIX}${DEAD_MANAGER_PID}`
    let deadWorkspaceId: string | null = null

    try {
      const spawned = await spawnHerdrSubagentTab(
        {
          sessionId: "sess-live-test",
          description: "live test worker",
          cwd: process.cwd(),
          serverUrl: "http://127.0.0.1:9", // dead port: delivery is what is under test
          workspaceLabel: liveLabel,
        },
        ops,
      )
      expect(spawned.success).toBe(true)
      expect(spawned.paneId).toMatch(/^w[0-9a-z]+:p[0-9a-z]+$/i)
      liveWorkspaceId = spawned.workspaceId ?? null
      expect(liveWorkspaceId).toBeTruthy()

      await new Promise((resolve) => setTimeout(resolve, 800))
      const text = await herdrReadPane(spawned.paneId as string, 30, ops)
      expect(text).toContain("opencode attach")

      // closing the pane leaves the workspace's root tab behind — that is the
      // documented herdr model (the manager closes the workspace at cleanup)
      expect(await herdrClosePaneIfExists(spawned.paneId as string, ops)).toBe("closed")

      // a pane id that never existed maps to "gone" (pins pane_not_found)
      expect(await herdrClosePaneIfExists(`${liveWorkspaceId}:p99999`, ops)).toBe("gone")

      // sweep: the dead-manager workspace closes, the live one survives
      const deadCreated = await runHerdrCommandDefault(
        ["workspace", "create", "--cwd", process.cwd(), "--label", deadLabel, "--no-focus"],
        { env: realEnv(), timeoutMs: 5_000 },
      )
      expect(deadCreated.success).toBe(true)
      deadWorkspaceId = (JSON.parse(deadCreated.output.trim()) as { result?: { workspace?: { workspace_id?: string } } })
        .result?.workspace?.workspace_id ?? null

      const removed = await sweepStaleHerdrAgentsWorkspaces(process.pid, ops)
      expect(removed).toContain(deadLabel)
      expect(removed).not.toContain(liveLabel)
      deadWorkspaceId = null // the sweep closed it

      const remaining = await herdrListWorkspacesByLabelPrefix(HERDR_AGENTS_WORKSPACE_LABEL_PREFIX, ops)
      expect(remaining.some((workspace) => workspace.label === liveLabel)).toBe(true)
      expect(remaining.some((workspace) => workspace.label === deadLabel)).toBe(false)
    } finally {
      if (liveWorkspaceId) await herdrCloseWorkspace(liveWorkspaceId, ops).catch(() => undefined)
      if (deadWorkspaceId) await herdrCloseWorkspace(deadWorkspaceId, ops).catch(() => undefined)
      if (server) await stopOwnedServer(server)
    }
  })
})
