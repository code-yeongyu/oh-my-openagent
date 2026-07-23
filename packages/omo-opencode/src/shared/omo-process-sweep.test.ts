import { describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sweepOrphanedLspDaemonProxies } from "@oh-my-opencode/utils/process-sweep"

import {
  sweepOmoFamiliesBestEffort,
  type OmoFamilySweeps,
} from "./omo-process-sweep"

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe("sweepOmoFamiliesBestEffort()", () => {
  it("#given all three family sweeps #when the sweep runs #then every family is invoked with a plugin root", async () => {
    // given
    const calls: string[] = []
    const pluginRoots: Array<string | undefined> = []
    const sweeps: OmoFamilySweeps = {
      sweepCodegraph: mock(async (options: { pluginRoot?: string }) => {
        calls.push("codegraph")
        pluginRoots.push(options.pluginRoot)
        return {}
      }) as unknown as OmoFamilySweeps["sweepCodegraph"],
      sweepLspProxies: mock(async (options: { pluginRoot?: string }) => {
        calls.push("lsp-proxies")
        pluginRoots.push(options.pluginRoot)
        return {}
      }) as unknown as OmoFamilySweeps["sweepLspProxies"],
      sweepStaleLspDaemons: mock(async () => {
        calls.push("stale-lsp-daemons")
        return {}
      }) as unknown as OmoFamilySweeps["sweepStaleLspDaemons"],
    }

    // when
    await sweepOmoFamiliesBestEffort({}, sweeps)

    // then
    expect(calls.sort()).toEqual(["codegraph", "lsp-proxies", "stale-lsp-daemons"])
    // codegraph + proxy families receive the opencode plugin root as an owned root
    expect(pluginRoots).toHaveLength(2)
    for (const root of pluginRoots) expect(root?.replace(/\\/g, "/").replace(/\/$/, "").endsWith("packages/omo-opencode")).toBe(true)
  })

  it("#given one family throws #when the sweep runs #then the failure is logged and the other families still run", async () => {
    // given
    const calls: string[] = []
    const logged: string[] = []
    const sweeps: OmoFamilySweeps = {
      sweepCodegraph: mock(async () => {
        calls.push("codegraph")
        throw new Error("codegraph boom")
      }) as unknown as OmoFamilySweeps["sweepCodegraph"],
      sweepLspProxies: mock(async () => {
        calls.push("lsp-proxies")
        return {}
      }) as unknown as OmoFamilySweeps["sweepLspProxies"],
      sweepStaleLspDaemons: mock(async () => {
        calls.push("stale-lsp-daemons")
        return {}
      }) as unknown as OmoFamilySweeps["sweepStaleLspDaemons"],
    }

    // when (must not reject)
    await sweepOmoFamiliesBestEffort({ log: (message) => logged.push(message) }, sweeps)

    // then
    expect(calls.sort()).toEqual(["codegraph", "lsp-proxies", "stale-lsp-daemons"])
    expect(logged.some((message) => message.includes("codegraph boom"))).toBe(true)
  })
})

describe("family throttle pass-through (T16 QA-b, unit level)", () => {
  it("#given a fresh stamp #when the proxy sweep runs twice inside the window #then the second run is throttled", async () => {
    // given an isolated HOME so the family stamp lands in a temp dir
    const home = tempDir("omo-t16-throttle-")
    try {
      const options = {
        env: { HOME: home },
        processProvider: async () => [],
      }

      // when the sweep runs twice within the throttle window
      const first = await sweepOrphanedLspDaemonProxies(options)
      const second = await sweepOrphanedLspDaemonProxies(options)

      // then the first run swept (and wrote the stamp) and the second respected it
      expect(first.action).toBe("swept")
      expect(second.action).toBe("throttled")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
