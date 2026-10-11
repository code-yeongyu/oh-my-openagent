import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { bunBinShimScript, ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import {
  baseInput,
  bunTreePackage,
  NON_POSIX_HOST,
  nodeModulesBinPath,
  POSIX_HOME,
  recorder,
} from "./bun-bin-shim.test-support"

/**
 * A bun-global install exposes the launcher through TWO bins: `<root>/bin/omo` and
 * `<root>/install/global/node_modules/.bin/omo`. PATH commonly lists the node_modules one first,
 * so the entry this file covers is the one a typed `omo` actually reaches - and the one that used
 * to pay for a full node boot before the launcher re-execed itself under bun.
 */
function entryOf(result: { entries: Array<{ label: string; path: string; action: string; error?: string }> }, label: string) {
  const entry = result.entries.find((candidate) => candidate.label === label)
  if (entry === undefined) throw new Error(`no ${label} entry in ${JSON.stringify(result.entries)}`)
  return entry
}

function tmpOf(path: string): string {
  return `${path}.4242.tmp`
}

describe.skipIf(NON_POSIX_HOST)("bun global node_modules/.bin shim", () => {
  const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))

  describe("#given both bins are bun's own symlinks into this install", () => {
    test("#then each one is replaced by the same shim through its own atomic rename", () => {
      // given
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const nodeModulesBin = nodeModulesBinPath(bunRootDir)
      const fs = recorder()
      fs.markLink(binPath)
      fs.markLink(nodeModulesBin)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath || path === nodeModulesBin ? scriptPath : path),
        ...fs,
      })
      // then - the legacy shape still answers for the primary bin, and both entries are reported
      expect(result.action).toBe("repaired")
      expect(entryOf(result, "bin")).toMatchObject({ path: binPath, action: "repaired" })
      expect(entryOf(result, "node-modules-bin")).toMatchObject({ path: nodeModulesBin, action: "repaired" })
      const script = bunBinShimScript(scriptPath, bunPath)
      expect(fs.written).toEqual([
        { path: tmpOf(binPath), content: script, mode: 0o755 },
        { path: tmpOf(nodeModulesBin), content: script, mode: 0o755 },
      ])
      expect(fs.renamed).toEqual([
        { from: tmpOf(binPath), to: binPath },
        { from: tmpOf(nodeModulesBin), to: nodeModulesBin },
      ])
      expect(fs.chmodded).toEqual([
        { path: tmpOf(binPath), mode: 0o755 },
        { path: tmpOf(nodeModulesBin), mode: 0o755 },
      ])
    })
  })

  describe("#given the node_modules/.bin entry is not ours to touch", () => {
    test("#then a link into another install is left alone while the bun bin is still repaired", () => {
      // given
      const { options, bunRootDir } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const nodeModulesBin = nodeModulesBinPath(bunRootDir)
      const fs = recorder()
      fs.markLink(binPath)
      fs.markLink(nodeModulesBin)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) =>
          path === binPath ? scriptPath
          : path === nodeModulesBin ? "/usr/local/lib/node_modules/omo-ai/bin/omo.js"
          : path,
        ...fs,
      })
      // then
      expect(entryOf(result, "node-modules-bin").action).toBe("foreign-link")
      expect(entryOf(result, "bin").action).toBe("repaired")
      expect(fs.written.map((entry) => entry.path)).toEqual([tmpOf(binPath)])
    })

    test("#then a file without the shim marker is left alone", () => {
      // given
      const { options, bunRootDir } = baseInput(scriptPath)
      const nodeModulesBin = nodeModulesBinPath(bunRootDir)
      const fs = recorder({ [nodeModulesBin]: "#!/bin/sh\nexec something-else\n" })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(entryOf(result, "node-modules-bin").action).toBe("foreign-file")
      expect(fs.written).toHaveLength(0)
    })
  })

  describe("#given only one of the two bins exists", () => {
    test("#then the missing node_modules/.bin entry is reported and the bun bin is still repaired", () => {
      // given - an npm-shaped tree, or a bun root whose global node_modules was never populated
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        ...fs,
      })
      // then
      expect(result.action).toBe("repaired")
      expect(entryOf(result, "node-modules-bin")).toMatchObject({
        path: nodeModulesBinPath(bunRootDir),
        action: "absent-bin",
      })
      expect(fs.written).toEqual([
        { path: tmpOf(binPath), content: bunBinShimScript(scriptPath, bunPath), mode: 0o755 },
      ])
    })
  })

  describe("#given the node_modules/.bin entry already carries the current shim", () => {
    test("#then it is not rewritten while the stale bun bin is", () => {
      // given
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const nodeModulesBin = nodeModulesBinPath(bunRootDir)
      const fs = recorder({ [nodeModulesBin]: bunBinShimScript(scriptPath, bunPath) })
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        ...fs,
      })
      // then
      expect(entryOf(result, "node-modules-bin").action).toBe("current")
      expect(fs.written.map((entry) => entry.path)).toEqual([tmpOf(binPath)])
      expect(fs.renamed).toEqual([{ from: tmpOf(binPath), to: binPath }])
    })
  })

  describe("#given writing one entry fails", () => {
    test("#then the other entry is still repaired and OMO_DEBUG narrates only the failure", () => {
      // given
      const { options, bunRootDir, bunPath } = baseInput(scriptPath, { env: { OMO_DEBUG: "1" } })
      const binPath = join(bunRootDir, "bin", "omo")
      const nodeModulesBin = nodeModulesBinPath(bunRootDir)
      const fs = recorder()
      fs.markLink(binPath)
      fs.markLink(nodeModulesBin)
      const warnings: string[] = []
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath || path === nodeModulesBin ? scriptPath : path),
        ...fs,
        write: (path: string, content: string, writeOptions: { mode: number }) => {
          if (path === tmpOf(nodeModulesBin)) throw new Error("EACCES: permission denied")
          fs.write(path, content, writeOptions)
        },
        warn: (message: string) => warnings.push(message),
      })
      // then
      expect(entryOf(result, "bin").action).toBe("repaired")
      expect(entryOf(result, "node-modules-bin")).toMatchObject({
        action: "failed",
        error: "EACCES: permission denied",
      })
      expect(fs.renamed).toEqual([{ from: tmpOf(binPath), to: binPath }])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(nodeModulesBin)
      expect(fs.written[0]?.content).toBe(bunBinShimScript(scriptPath, bunPath))
    })
  })

  describe("#given the launch context rules the repair out", () => {
    test("#then a skipped launch reports no entries at all", () => {
      // given
      const { options } = baseInput("/usr/local/lib/node_modules/omo-ai/bin/omo.js")
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("skipped-install")
      expect(result.entries).toEqual([])
    })
  })
})
