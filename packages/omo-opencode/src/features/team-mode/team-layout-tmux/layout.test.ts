/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as coreLayout from "@oh-my-opencode/team-core/team-layout-tmux/layout"
import type { RunTmuxOptions, TmuxCommandResult } from "@oh-my-opencode/tmux-core"

import { createOpenCodeTmuxServerAccess } from "../../../shared/tmux"
import * as layoutFacade from "./layout"

type EnvironmentSnapshot = {
  present: boolean
  value: string | undefined
}

const FIXTURE_PASSWORD = ["fixture", "password"].join("-")
const FIXTURE_USERNAME = ["fixture", "user"].join("-")

function snapshotEnvironmentVariable(name: string): EnvironmentSnapshot {
  return {
    present: Object.hasOwn(process.env, name),
    value: process.env[name],
  }
}

function restoreEnvironmentVariable(name: string, snapshot: EnvironmentSnapshot): void {
  if (snapshot.present && snapshot.value !== undefined) {
    process.env[name] = snapshot.value
    return
  }
  delete process.env[name]
}

function commandResult(output = ""): TmuxCommandResult {
  return { success: true, output, stdout: output, stderr: "", exitCode: 0 }
}

function paneEnvironment(args: ReadonlyArray<string>): Record<string, string> {
  const bindings = args.flatMap((value, index) => value === "-e" && args[index + 1] !== undefined
    ? [args[index + 1]]
    : [])
  return Object.fromEntries(bindings.map((binding) => {
    const separator = binding.indexOf("=")
    return [binding.slice(0, separator), binding.slice(separator + 1)]
  }))
}

function createLayoutHarness() {
  const calls: Array<Array<string>> = []
  const executions: Array<{ args: Array<string>; options?: RunTmuxOptions }> = []
  const runTmuxCommand = mock(async (_tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
    calls.push(args)
    executions.push({ args, options })
    const [command] = args
    switch (command) {
      case "list-panes":
        return commandResult("%caller")
      case "split-window":
        return commandResult("%member")
      case "show-options":
        return commandResult("run-adapter-cleanup")
      default:
        return commandResult()
    }
  })

  return {
    calls,
    executions,
    deps: {
      runTmuxCommand,
      isServerRunning: mock(async () => true),
      getTmuxPath: mock(async () => "tmux"),
      resolveCallerTmuxSession: mock(async () => ({
        sessionId: "$caller",
        paneId: "%caller",
        windowTarget: "session:0",
      })),
      log: mock(() => undefined),
    },
  }
}

function findCommand(calls: ReadonlyArray<ReadonlyArray<string>>, command: string): ReadonlyArray<string> {
  const args = calls.find(([candidateCommand]) => candidateCommand === command)
  if (!args) throw new Error(`Expected ${command} command`)
  return args
}

describe("team layout adapter facade", () => {
  let tmuxEnvironment: EnvironmentSnapshot

  beforeEach(() => {
    tmuxEnvironment = snapshotEnvironmentVariable("TMUX")
    process.env.TMUX = "/tmp/omo-adapter-contract"
  })

  afterEach(() => {
    restoreEnvironmentVariable("TMUX", tmuxEnvironment)
    expect(snapshotEnvironmentVariable("TMUX")).toEqual(tmuxEnvironment)
  })

  test("re-exports the team-core layout contract by reference", () => {
    expect(layoutFacade.canVisualize).toBe(coreLayout.canVisualize)
    expect(layoutFacade.createTeamLayout).toBe(coreLayout.createTeamLayout)
    expect(layoutFacade.removeTeamLayout).toBe(coreLayout.removeTeamLayout)
  })

  test.each([
    {
      label: "trusted current-context target",
      target: {
        serverUrl: "http://127.0.0.1:4096",
        source: "current-context" as const,
        trusted: true,
      },
      expectedEnvironment: {
        OPENCODE_SERVER_PASSWORD: FIXTURE_PASSWORD,
        OPENCODE_SERVER_USERNAME: FIXTURE_USERNAME,
      },
      expectedClears: false,
    },
    {
      label: "synthetic anonymous target",
      target: {
        serverUrl: "http://localhost:4096",
        source: "synthetic-fallback" as const,
        trusted: false,
      },
      expectedEnvironment: {},
      expectedClears: true,
    },
  ])("composes $label access through the facade", async ({ target, expectedEnvironment, expectedClears }) => {
    const harness = createLayoutHarness()
    const serverAccess = createOpenCodeTmuxServerAccess(target, {
      fetchImplementation: mock(async () => new Response(null, { status: 200 })),
      getEnvironment: () => ({
        OPENCODE_SERVER_PASSWORD: FIXTURE_PASSWORD,
        OPENCODE_SERVER_USERNAME: FIXTURE_USERNAME,
      }),
    })

    const result = await layoutFacade.createTeamLayout(
      "run-adapter-contract",
      [{ name: "member", sessionId: "session-member", worktreePath: "/tmp/member" }],
      {
        getServerUrl: () => serverAccess.serverUrl,
        getTmuxServerAccess: () => serverAccess,
      },
      harness.deps,
    )

    expect(result?.focusPanesByMember).toEqual({ member: "%member" })
    const split = findCommand(harness.calls, "split-window")
    expect(paneEnvironment(split)).toEqual(expectedEnvironment)
    expect(split.at(-1)?.startsWith("env -u OPENCODE_SERVER_PASSWORD -u OPENCODE_SERVER_USERNAME -- "))
      .toBe(expectedClears)
  })

  test("scrubs OpenCode capability keys from regular Team cleanup execution", async () => {
    const passwordEnvironment = snapshotEnvironmentVariable("OPENCODE_SERVER_PASSWORD")
    const usernameEnvironment = snapshotEnvironmentVariable("OPENCODE_SERVER_USERNAME")
    process.env.OPENCODE_SERVER_PASSWORD = FIXTURE_PASSWORD
    process.env.OPENCODE_SERVER_USERNAME = FIXTURE_USERNAME
    const harness = createLayoutHarness()
    const serverAccess = createOpenCodeTmuxServerAccess({
      serverUrl: "http://localhost:4096",
      source: "synthetic-fallback",
      trusted: false,
    })

    try {
      await layoutFacade.removeTeamLayout(
        "run-adapter-cleanup",
        {
          ownedSession: false,
          targetSessionId: "$caller",
          paneIds: ["%member"],
          executionTarget: {
            backend: "tmux",
            tmuxEnvironment: "/tmp/omo-adapter-contract",
          },
        },
        {
          getServerUrl: () => serverAccess.serverUrl,
          getTmuxServerAccess: () => serverAccess,
        },
        harness.deps,
      )

      const cleanup = harness.executions.find(({ args }) => args[0] === "kill-pane")
      expect(cleanup).toBeDefined()
      expect(cleanup?.options?.environment?.OPENCODE_SERVER_PASSWORD).toBeUndefined()
      expect(cleanup?.options?.environment?.OPENCODE_SERVER_USERNAME).toBeUndefined()
    } finally {
      restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", passwordEnvironment)
      restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", usernameEnvironment)
    }
  })
})
