import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { ExtensionAPI } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { InProcessRunner } from "../in-process"
import {
  acceptsConnections,
  createBuiltinChildMachine,
  loopbackPort,
  openBoundSession,
  watchHttpServers,
  type BuiltinChildMachine,
  type ServerWatch,
} from "./__fixtures__/builtin-child"
import { createRestoredChildHandle, type ChildSession } from "./child-handle"

// #9413: an in-process child loads senpi's builtin extensions, and codemode closes its per-session
// bridge server only on session_shutdown. A bridge port that still accepts connections after
// teardown is exactly the leak that kept `omo -p` alive.

const PRINT_RUN = join(import.meta.dir, "__fixtures__", "print-run.ts")
const BRIDGE_RUN = join(import.meta.dir, "__fixtures__", "bridge-run.ts")
const PRINT_RUN_BOUND_MS = 90_000

let watch: ServerWatch | undefined
let machine: BuiltinChildMachine | undefined

afterEach(() => {
  for (const server of watch?.servers ?? []) {
    server.closeAllConnections()
    server.close()
  }
  watch?.stop()
  watch = undefined
  machine?.cleanup()
  machine = undefined
})

function listeningPorts(servers: ServerWatch): number[] {
  return servers.servers.filter((server) => server.listening).map(loopbackPort)
}

async function stillOpen(ports: readonly number[]): Promise<number[]> {
  const open = await Promise.all(ports.map(async (port) => ((await acceptsConnections(port)) ? [port] : [])))
  return open.flat()
}

type PrintRun = { readonly exit: number | "still running"; readonly stdout: string; readonly stderr: string }

type BridgeRun = { readonly bridges: number; readonly stillListening: number; readonly stillOpen: number; readonly startError?: string }

// AC1/AC3 run in a fresh process: a shared test process can already hold module state from other
// files (an earlier codemode load), which hides the bridge from a listen hook armed later.
async function bridgeRun(scenario: "ac1" | "ac3"): Promise<BridgeRun> {
  const run = await spawnBounded(BRIDGE_RUN, scenario)
  if (run.exit !== 0) throw new Error(`bridge run ${scenario} did not exit cleanly (${run.exit}): ${run.stderr}`)
  return JSON.parse(run.stdout) as BridgeRun
}

async function printRun(turn: "succeeds" | "fails"): Promise<PrintRun> {
  return spawnBounded(PRINT_RUN, turn)
}

async function spawnBounded(script: string, arg: string): Promise<PrintRun> {
  const child = Bun.spawn([process.execPath, script, arg], { stdout: "pipe", stderr: "pipe" })
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<"still running">((resolve) => {
    watchdog = setTimeout(() => resolve("still running"), PRINT_RUN_BOUND_MS)
  })
  const exit = await Promise.race([child.exited, bound])
  clearTimeout(watchdog)
  if (exit === "still running") child.kill("SIGKILL")
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exit, stdout, stderr }
}

describe("in-process child teardown shuts down its extensions (#9413)", () => {
  test("#9413 AC1: disposing an in-process child that loaded the builtin extensions runs its session_shutdown handlers and closes its codemode bridge, leaving no listening socket", async () => {
    // when: a real child with the builtin extensions settles its turn and is disposed
    const run = await bridgeRun("ac1")

    // then: it had opened exactly one codemode bridge, and after teardown nothing listens or accepts
    expect(run).toEqual({ bridges: 1, stillListening: 0, stillOpen: 0 })
  }, PRINT_RUN_BOUND_MS + 30_000)

  test.each(["succeeds", "fails"] as const)(
    "#9413 AC2: a print run that delegates one in-process task to a child that %s exits with code 0 within the bound",
    async (turn) => {
      // when: the run delegates one in-process task, tears it down, and returns from the top level
      const run = await printRun(turn)

      // then: nothing the child left behind keeps the process alive
      expect({ exit: run.exit, stderr: run.exit === 0 ? "" : run.stderr }).toEqual({ exit: 0, stderr: "" })
      expect(JSON.parse(run.stdout)).toEqual({ status: turn === "succeeds" ? "completed" : "error" })
    },
    PRINT_RUN_BOUND_MS + 30_000,
  )

  test("#9413 AC3: discardUnstartedChildSession gives a child whose handle never started the same shutdown, closing its codemode bridge", async () => {
    // when: a real builtin session opens, but its handle construction fails, so the runner discards it unstarted
    const run = await bridgeRun("ac3")

    // then: the start failed, and the bridge that session opened was shut down before being disposed
    expect(run).toEqual({ bridges: 1, stillListening: 0, stillOpen: 0, startError: "handle construction failed" })
  }, PRINT_RUN_BOUND_MS + 30_000)

  test("a hung session_shutdown handler does not block child teardown past the host budget", async () => {
    // given: a child with an extension whose session_shutdown handler never settles, under a 300ms budget
    machine = await createBuiltinChildMachine()
    const senpi = await loadSenpiBarrel()
    const settingsManager = senpi.SettingsManager.inMemory({ sessionShutdownHandlerTimeoutMs: 300 })
    let shutdownSignal: AbortSignal | undefined
    const hangsOnShutdown = (pi: ExtensionAPI): void => {
      pi.on("session_shutdown", (event) => {
        shutdownSignal = event.signal
        return new Promise<void>(() => undefined)
      })
    }
    const session = await openBoundSession({
      cwd: machine.cwd,
      agentDir: machine.agentDir,
      model: machine.model,
      modelRuntime: machine.modelRuntime,
      modelRegistry: machine.modelRegistry,
      settingsManager,
      sessionManager: senpi.SessionManager.inMemory(),
      resourceLoader: new senpi.DefaultResourceLoader({
        cwd: machine.cwd,
        agentDir: machine.agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [{ name: "hangs-on-shutdown", factory: hangsOnShutdown }],
      }),
    })
    let disposed = false
    const dispose = session.dispose.bind(session)
    session.dispose = () => {
      disposed = true
      dispose()
    }
    const handle = createRestoredChildHandle({ taskId: "hung-child", session })

    // when: teardown waits only for the budget, never for the hung handler
    await handle.dispose()

    // then: the handler was asked to stop at the budget, and the session was still disposed
    expect(shutdownSignal?.aborted).toBe(true)
    expect(disposed).toBe(true)
  }, 120_000)
})
