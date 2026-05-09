/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"

import { reapStaleTailers, type ReapDeps } from "./reap-stale-tailers"

describe("reapStaleTailers", () => {
  it("#given mixed reachable and unreachable URLs #when reap #then dispatches SIGTERM only to PIDs whose URL is unreachable", async () => {
    const killed: number[] = []
    const deps: ReapDeps = {
      listTailerProcesses: async () => [
        { pid: 1, url: "http://A:4096" },
        { pid: 2, url: "http://B:4096" },
      ],
      probeUrl: async (url) => url === "http://A:4096",
      killPid: (pid) => {
        killed.push(pid)
      },
    }

    const result = await reapStaleTailers({ deps })

    expect(killed).toEqual([2])
    expect(result.reapedPids).toEqual([2])
    expect(result.livePids).toEqual([1])
    expect(result.unreachableUrls).toEqual(["http://B:4096"])
  })

  it("#given multiple PIDs sharing the same URL #when reap #then probeUrl is invoked exactly once for that URL", async () => {
    const probeUrlMock = mock(async (_url: string, _timeoutMs: number) => false)
    const deps: ReapDeps = {
      listTailerProcesses: async () => [
        { pid: 10, url: "http://X:4096" },
        { pid: 11, url: "http://X:4096" },
        { pid: 12, url: "http://X:4096" },
      ],
      probeUrl: probeUrlMock,
      killPid: () => {},
    }

    await reapStaleTailers({ deps })

    expect(probeUrlMock).toHaveBeenCalledTimes(1)
  })

  it("#given killPid throws for first PID #when reap #then resolves and reapedPids contains second PID only", async () => {
    const deps: ReapDeps = {
      listTailerProcesses: async () => [
        { pid: 100, url: "http://dead:4096" },
        { pid: 101, url: "http://dead:4096" },
      ],
      probeUrl: async () => false,
      killPid: (pid) => {
        if (pid === 100) throw new Error("ESRCH")
      },
    }

    const result = await reapStaleTailers({ deps })

    expect(result.reapedPids).toEqual([101])
    expect(result.unreachableUrls).toEqual(["http://dead:4096"])
  })

  it("#given empty process list #when reap #then returns all-empty result", async () => {
    const deps: ReapDeps = {
      listTailerProcesses: async () => [],
      probeUrl: async () => true,
      killPid: () => {},
    }

    const result = await reapStaleTailers({ deps })

    expect(result).toEqual({ reapedPids: [], livePids: [], unreachableUrls: [] })
  })
})
