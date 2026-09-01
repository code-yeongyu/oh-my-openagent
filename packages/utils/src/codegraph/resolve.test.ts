import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CODEGRAPH_PINNED_VERSION } from "./manifest"
import { resolveCodegraphCommand } from "./resolve"

describe("resolveCodegraphCommand managed runtime version", () => {
  it("#given only a stale managed runtime #when resolving Codegraph #then the stale binary is ignored", () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-resolve-stale-"))
    try {
      const installDir = join(homeDir, ".omo", "codegraph")
      const staleBin = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
      const staleMarker = join(installDir, ".provisioned", "codegraph-1.0.1.json")
      mkdirSync(join(installDir, "bin"), { recursive: true })
      mkdirSync(join(installDir, ".provisioned"), { recursive: true })
      writeFileSync(staleBin, "")
      writeFileSync(staleMarker, `${JSON.stringify({ binPath: staleBin, version: "1.0.1" })}\n`)

      // when
      const resolution = resolveCodegraphCommand({
        env: {},
        homeDir,
        nodeRuntime: () => null,
        requireResolve: () => {
          throw new Error("no bundled runtime")
        },
        which: () => null,
      })

      // then
      expect(resolution).toEqual({
        argsPrefix: [],
        command: "codegraph",
        exists: false,
        source: "path",
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given the pinned managed runtime marker #when resolving Codegraph #then the managed binary is accepted", () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-resolve-pinned-"))
    try {
      const installDir = join(homeDir, ".omo", "codegraph")
      const pinnedBin = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
      const pinnedMarker = join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`)
      mkdirSync(join(installDir, "bin"), { recursive: true })
      mkdirSync(join(installDir, ".provisioned"), { recursive: true })
      writeFileSync(pinnedBin, "")
      writeFileSync(pinnedMarker, `${JSON.stringify({ binPath: pinnedBin, version: CODEGRAPH_PINNED_VERSION })}\n`)

      // when
      const resolution = resolveCodegraphCommand({
        env: {},
        homeDir,
        nodeRuntime: () => null,
        requireResolve: () => {
          throw new Error("no bundled runtime")
        },
        which: () => null,
      })

      // then
      expect(resolution).toEqual({
        argsPrefix: [],
        command: pinnedBin,
        exists: true,
        source: "provisioned",
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a pinned marker points outside its managed install #when resolving Codegraph #then the external path is rejected", () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-resolve-external-"))
    try {
      const installDir = join(homeDir, ".omo", "codegraph")
      const expectedBin = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
      const externalBin = join(homeDir, "external-codegraph")
      const pinnedMarker = join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`)
      mkdirSync(join(installDir, "bin"), { recursive: true })
      mkdirSync(join(installDir, ".provisioned"), { recursive: true })
      writeFileSync(expectedBin, "")
      writeFileSync(externalBin, "")
      writeFileSync(pinnedMarker, `${JSON.stringify({ binPath: externalBin, version: CODEGRAPH_PINNED_VERSION })}\n`)

      // when
      const resolution = resolveCodegraphCommand({
        env: {},
        homeDir,
        nodeRuntime: () => null,
        requireResolve: () => {
          throw new Error("no bundled runtime")
        },
        which: () => null,
      })

      // then
      expect(resolution).toEqual({
        argsPrefix: [],
        command: "codegraph",
        exists: false,
        source: "path",
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})
