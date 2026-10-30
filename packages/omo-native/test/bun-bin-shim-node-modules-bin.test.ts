import { describe, expect, test } from "bun:test"
import { dirname, join, relative } from "node:path"
import { ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import { baseInput, bunTreePackage, legacyShim, NON_POSIX_HOST, nodeModulesBinPath, POSIX_HOME, recorder } from "./bun-bin-shim.test-support"

describe.skipIf(NON_POSIX_HOST)("both Bun global bin entries", () => {
  const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))

  test("#given two stock links #then neither is replaced", () => {
    const { options, bunRootDir } = baseInput(scriptPath)
    const bins = [join(bunRootDir, "bin", "omo"), nodeModulesBinPath(bunRootDir)]
    const fs = recorder()
    for (const bin of bins) fs.markLink(bin)
    const result = ensureBunBinShim({
      ...options, ...fs, realpath: (path: string) => bins.includes(path) ? scriptPath : path,
    })
    expect(result.entries.map(entry => entry.action)).toEqual(["current", "current"])
    expect(fs.linked).toHaveLength(0)
    expect(fs.renamed.map(entry => entry.to)).toEqual([scriptPath])
  })

  test("#given two legacy wrappers #then both become links to the same entrypoint", () => {
    const { options, bunRootDir, bunPath } = baseInput(scriptPath)
    const bins = [join(bunRootDir, "bin", "omo"), nodeModulesBinPath(bunRootDir)]
    const fs = recorder(Object.fromEntries(bins.map(bin => [bin, legacyShim(scriptPath, bunPath)])))
    const result = ensureBunBinShim({ ...options, ...fs })
    expect(result.entries.map(entry => entry.action)).toEqual(["repaired", "repaired"])
    expect(fs.linked).toEqual(bins.map(bin => ({
      target: relative(dirname(bin), scriptPath), path: `${bin}.4242.tmp`,
    })))
    expect(bins.every(bin => fs.lstat(bin).isSymbolicLink())).toBe(true)
  })

  for (const foreign of ["link", "file", "absent"]) {
    test(`#given a ${foreign} secondary entry #then the primary legacy wrapper still migrates`, () => {
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const secondary = nodeModulesBinPath(bunRootDir)
      const fs = recorder({
        [binPath]: legacyShim(scriptPath, bunPath),
        ...(foreign === "file" ? { [secondary]: "#!/bin/sh\nexec another-command\n" } : {}),
      })
      if (foreign === "link") fs.markLink(secondary)
      const result = ensureBunBinShim({
        ...options, ...fs, realpath: (path: string) => path === secondary ? "/other/omo.js" : path,
      })
      expect(result.action).toBe("repaired")
      expect(result.entries[1]?.action).toBe(foreign === "absent" ? "absent-bin" : `foreign-${foreign}`)
      expect(fs.linked.map(entry => entry.path)).toEqual([`${binPath}.4242.tmp`])
    })
  }

  for (const failingIndex of [0, 1]) {
    test(`#given migration ${failingIndex} fails #then the other entry migrates independently`, () => {
      const { options, bunRootDir, bunPath } = baseInput(scriptPath, { env: { OMO_DEBUG: "1" } })
      const bins = [join(bunRootDir, "bin", "omo"), nodeModulesBinPath(bunRootDir)]
      const fs = recorder(Object.fromEntries(bins.map(bin => [bin, legacyShim(scriptPath, bunPath)])))
      const warnings: string[] = []
      const result = ensureBunBinShim({
        ...options, ...fs,
        symlink: (target: string, path: string) => {
          if (path === `${bins[failingIndex]}.4242.tmp`) throw new Error("EACCES: permission denied")
          fs.symlink(target, path)
        },
        warn: (message: string) => warnings.push(message),
      })
      expect(result.entries[failingIndex]?.action).toBe("failed")
      expect(result.entries[1 - failingIndex]?.action).toBe("repaired")
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("EACCES")
    })
  }

  test("#given one current link #then only the other legacy wrapper migrates", () => {
    const { options, bunRootDir, bunPath } = baseInput(scriptPath)
    const primary = join(bunRootDir, "bin", "omo")
    const secondary = nodeModulesBinPath(bunRootDir)
    const fs = recorder({ [primary]: legacyShim(scriptPath, bunPath) })
    fs.markLink(secondary)
    const result = ensureBunBinShim({
      ...options, ...fs, realpath: (path: string) => path === secondary ? scriptPath : path,
    })
    expect(result.entries.map(entry => entry.action)).toEqual(["repaired", "current"])
    expect(fs.linked.map(entry => entry.path)).toEqual([`${primary}.4242.tmp`])
  })
})
