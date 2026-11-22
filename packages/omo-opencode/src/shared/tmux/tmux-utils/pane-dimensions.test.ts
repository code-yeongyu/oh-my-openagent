import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const paneDimensionsSpecifier = import.meta.resolve("./pane-dimensions")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")
// Complete module mocks: once bun has built a module from a mock factory, that module keeps the factory's export names
// for the rest of the process, so a partial mock hides the real exports from every later test file even after the
// restore (#13331). Each factory spreads the real module and overrides only what this file controls.
const actualRunner = await import(runnerSpecifier)
const actualTmuxPathResolver = await import(tmuxPathResolverSpecifier)

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
  success: true,
  output: "80,160",
  stdout: "80,160",
  stderr: "",
  exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")

async function loadGetPaneDimensions(): Promise<typeof import("./pane-dimensions").getPaneDimensions> {
  const module = await import(`${paneDimensionsSpecifier}?test=${crypto.randomUUID()}`)
  return module.getPaneDimensions
}

function registerModuleMocks(): void {
  mock.module(runnerSpecifier, () => ({ ...actualRunner, runTmuxCommand: runTmuxCommandMock }))
  mock.module(tmuxPathResolverSpecifier, () => ({ ...actualTmuxPathResolver, getTmuxPath: getTmuxPathMock }))
}

describe("getPaneDimensions runner integration", () => {
  beforeEach(() => {
    registerModuleMocks()
    runTmuxCommandMock.mockClear()
    getTmuxPathMock.mockClear()

    runTmuxCommandMock.mockResolvedValue({ success: true, output: "80,160", stdout: "80,160", stderr: "", exitCode: 0 })
    getTmuxPathMock.mockResolvedValue("sh")
  })

  it("#given pane id #when getPaneDimensions called #then delegates display to shared runner", async () => {
    // given
    const getPaneDimensions = await loadGetPaneDimensions()

    // when
    const result = await getPaneDimensions("%42")

    // then
    expect(result).toEqual({ paneWidth: 80, windowWidth: 160 })
    expect(runTmuxCommandMock.mock.calls).toEqual([
      [[expect.any(String), ["display", "-p", "-t", "%42", "#{pane_width},#{window_width}"]]][0],
    ])
  })
})
