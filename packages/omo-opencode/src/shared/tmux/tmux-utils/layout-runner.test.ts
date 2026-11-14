import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const layoutSpecifier = import.meta.resolve("./layout")
const loggerSpecifier = import.meta.resolve("../../logger")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")
// Complete module mocks: once bun has built a module from a mock factory, that module keeps the factory's export names
// for the rest of the process, so a partial mock hides the real exports from every later test file even after the
// restore (#13331). Each factory spreads the real module and overrides only what this file controls.
const actualLogger = await import(loggerSpecifier)
const actualRunner = await import(runnerSpecifier)
const actualTmuxPathResolver = await import(tmuxPathResolverSpecifier)

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
  success: true,
  output: "",
  stdout: "",
  stderr: "",
  exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadEnforceMainPaneWidth(): Promise<typeof import("./layout").enforceMainPaneWidth> {
  const module = await import(`${layoutSpecifier}?test=${crypto.randomUUID()}`)
  return module.enforceMainPaneWidth
}

function registerModuleMocks(): void {
  mock.module(loggerSpecifier, () => ({ ...actualLogger, log: logMock }))
  mock.module(runnerSpecifier, () => ({ ...actualRunner, runTmuxCommand: runTmuxCommandMock }))
  mock.module(tmuxPathResolverSpecifier, () => ({ ...actualTmuxPathResolver, getTmuxPath: getTmuxPathMock }))
}

describe("enforceMainPaneWidth runner integration", () => {
  beforeEach(() => {
    registerModuleMocks()
    runTmuxCommandMock.mockClear()
    getTmuxPathMock.mockClear()
    logMock.mockClear()

    runTmuxCommandMock.mockResolvedValue({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
    getTmuxPathMock.mockResolvedValue("sh")
  })

  it("#given pane width inputs #when enforceMainPaneWidth called #then delegates resize-pane to shared runner", async () => {
    // given
    const enforceMainPaneWidth = await loadEnforceMainPaneWidth()

    // when
    await enforceMainPaneWidth("%42", 200, 60)

    // then
    expect(runTmuxCommandMock.mock.calls).toEqual([
      [[expect.any(String), ["resize-pane", "-t", "%42", "-x", "119"]]][0],
    ])
  })
})
