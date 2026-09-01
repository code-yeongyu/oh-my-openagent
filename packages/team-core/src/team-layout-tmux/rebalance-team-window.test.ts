/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"

import {
  rebalanceTeamWindowWith,
  type RebalanceTeamWindowDeps,
} from "./rebalance-team-window"

describe("rebalanceTeamWindowWith", () => {
  let runTmux: RebalanceTeamWindowDeps["runTmux"]
  let log: RebalanceTeamWindowDeps["log"]
  let calls: Array<Array<string>>

  beforeEach(() => {
    calls = []
    runTmux = mock(async (args: string[]): Promise<{ success: boolean }> => {
      calls.push(args)
      return { success: true }
    })
    log = mock((): void => undefined)
  })

  it("#given main-vertical #when rebalance #then select-layout, set main-pane-width 60%, re-select-layout", async () => {
    // given
    const deps: RebalanceTeamWindowDeps = { runTmux, log }

    // when
    const result = await rebalanceTeamWindowWith("@1", "main-vertical", deps)

    // then
    expect(result).toBe(true)
    expect(calls).toEqual([
      ["select-layout", "-t", "@1", "main-vertical"],
      ["set-window-option", "-t", "@1", "main-pane-width", "60%"],
      ["select-layout", "-t", "@1", "main-vertical"],
    ])
  })

  it("#given focus windowId and pane-list shrunk from 3 to 2 #when rebalanceTeamWindow runs #then select-layout is invoked with main-vertical", async () => {
    // given
    const deps: RebalanceTeamWindowDeps = { runTmux, log }

    // when
    const result = await rebalanceTeamWindowWith("@focus", "main-vertical", deps)

    // then
    expect(result).toBe(true)
    expect(calls).toEqual([
      ["select-layout", "-t", "@focus", "main-vertical"],
      ["set-window-option", "-t", "@focus", "main-pane-width", "60%"],
      ["select-layout", "-t", "@focus", "main-vertical"],
    ])
  })

  it("#given tiled #when rebalance #then only select-layout called", async () => {
    // given
    const deps: RebalanceTeamWindowDeps = { runTmux, log }

    // when
    const result = await rebalanceTeamWindowWith("@1", "tiled", deps)

    // then
    expect(result).toBe(true)
    expect(calls).toEqual([["select-layout", "-t", "@1", "tiled"]])
  })

  it("#given select-layout fails #when rebalance #then returns false, log once", async () => {
    // given
    runTmux = mock(async (args: string[]): Promise<{ success: boolean }> => {
      calls.push(args)
      return { success: false }
    })

    const deps: RebalanceTeamWindowDeps = { runTmux, log }

    // when
    const result = await rebalanceTeamWindowWith("@1", "main-vertical", deps)

    // then
    expect(result).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
  })
})
