import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildInstallCli, checkInstallCliCurrent } from "./build-install.mjs"

// Authoring gate (test-discipline.md):
// 1. Contract: the generated installer ships at mode 0644, and `build-install --check`
//    fails on a mode-only drift, so a container regen can never flip a tracked file's
//    mode silently again (fixes #12394, which already shipped once).
// 2. Credible regression: a regen overwrites install.mjs while the file carries 0755
//    (container tree copy), and the mode bit rides the patch onto dev unnoticed.
// 3. No existing coverage: checkInstallCliCurrent compares content only; the 0755
//    flip passed every existing test. These tests own the mode contract at the
//    build-install boundary.
// 4. No new production seam: both functions already take an options bag with
//    outputPath; the tests call the real boundary.

const describePosix = process.platform === "win32" ? describe.skip : describe

async function buildInstallerTo(dir) {
  const outputPath = join(dir, "scripts", "install.mjs")
  await buildInstallCli({ outputPath })
  return outputPath
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777
}

describePosix("build-install installer mode (fixes #12394)", () => {
  test("#given a committed installer with mode 0755 and fresh content #when checkInstallCliCurrent runs #then it reports not current with a mode reason", async () => {
    // given
    const dir = await mkdtemp(join(tmpdir(), "omo-install-mode-check-"))
    try {
      const outputPath = await buildInstallerTo(dir)
      await chmod(outputPath, 0o755)
      expect(await modeOf(outputPath)).toBe(0o755)
      // when
      const result = await checkInstallCliCurrent({ outputPath })
      // then
      expect(result.current).toBe(false)
      expect(result.reason).toMatch(/mode/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("#given an output path that already carries mode 0755 #when buildInstallCli runs #then the written installer is mode 0644", async () => {
    // given
    const dir = await mkdtemp(join(tmpdir(), "omo-install-mode-build-"))
    try {
      const outputPath = join(dir, "scripts", "install.mjs")
      const { mkdir } = await import("node:fs/promises")
      await mkdir(join(dir, "scripts"), { recursive: true })
      await writeFile(outputPath, "// stale placeholder\n")
      await chmod(outputPath, 0o755)
      expect(await modeOf(outputPath)).toBe(0o755)
      // when
      await buildInstallCli({ outputPath })
      // then
      expect(await modeOf(outputPath)).toBe(0o644)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("#given a fresh build at mode 0644 #when checkInstallCliCurrent runs #then it reports current", async () => {
    // given
    const dir = await mkdtemp(join(tmpdir(), "omo-install-mode-control-"))
    try {
      const outputPath = await buildInstallerTo(dir)
      expect(await modeOf(outputPath)).toBe(0o644)
      // when
      const result = await checkInstallCliCurrent({ outputPath })
      // then
      expect(result).toEqual({ current: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("#given a committed installer whose content differs from a fresh build #when checkInstallCliCurrent runs #then it reports stale", async () => {
    // given
    const dir = await mkdtemp(join(tmpdir(), "omo-install-mode-stale-"))
    try {
      const outputPath = await buildInstallerTo(dir)
      const content = await readFile(outputPath, "utf8")
      await writeFile(outputPath, `${content}\n// drift\n`)
      // when
      const result = await checkInstallCliCurrent({ outputPath })
      // then
      expect(result.current).toBe(false)
      expect(result.reason).toMatch(/stale installer/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
