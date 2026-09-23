/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { deployStandaloneParity, rollbackStandaloneParity } from "./deployment"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone parity deployment", () => {
  test("#given a verified staged payload #when deployment is rolled back #then restores the prior isolated config and payload", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-standalone-deploy-"))
    roots.push(root)
    const stagingRoot = join(root, "staging")
    const parityRoot = join(root, "standalone-parity")
    const configPath = join(root, "home", ".omo", "omo.jsonc")
    await mkdir(stagingRoot, { recursive: true })
    await mkdir(join(parityRoot, "current"), { recursive: true })
    await mkdir(join(root, "home", ".omo"), { recursive: true })
    await writeFile(join(stagingRoot, "manifest.json"), '{"version":1,"generatedAt":"2026-09-19T00:00:00.000Z","skills":[],"commands":[],"mcps":[],"instructionsPath":"instructions.md","routingPath":"routing.json","files":{}}')
    await writeFile(join(parityRoot, "current", "previous.txt"), "previous")
    await writeFile(configPath, "previous-config")

    // when
    await deployStandaloneParity({ stagingRoot, parityRoot, configPath, overlay: "next-config" })
    await rollbackStandaloneParity({ parityRoot, configPath })

    // then
    expect(await readFile(join(parityRoot, "current", "previous.txt"), "utf8")).toBe("previous")
    expect(await readFile(configPath, "utf8")).toBe("previous-config")
  })

  for (const boundary of ["journal", "payload", "config"] as const) {
    test(`#given prior isolated state #when deployment fails after the ${boundary} mutation #then restores both protected targets`, async () => {
      // given
      const fixture = await deploymentFixture()

      // when
      const deployment = deployStandaloneParity({
        ...fixture,
        overlay: "next-config",
        afterMutation: (completed) => {
          if (completed === boundary) throw new Error(`injected ${boundary} failure`)
        },
      })

      // then
      await expect(deployment).rejects.toThrow(`injected ${boundary} failure`)
      expect(await readFile(join(fixture.parityRoot, "current", "previous.txt"), "utf8")).toBe("previous")
      expect(await readFile(fixture.configPath, "utf8")).toBe("previous-config")
      expect(await stat(join(dirname(fixture.configPath), "agent", "settings.json"), { throwIfNoEntry: false })).toBeUndefined()
      expect(await stat(join(fixture.parityRoot, ".next"), { throwIfNoEntry: false })).toBeUndefined()
    })
  }

  test("#given no prior payload or config #when first install is rolled back #then removes both newly installed targets", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-standalone-first-install-"))
    roots.push(root)
    const stagingRoot = join(root, "staging")
    const parityRoot = join(root, "standalone-parity")
    const configPath = join(root, "home", ".omo", "omo.jsonc")
    await writeManifest(stagingRoot)

    // when
    await deployStandaloneParity({ stagingRoot, parityRoot, configPath, overlay: "next-config" })
    await rollbackStandaloneParity({ parityRoot, configPath })

    // then
    expect(await stat(join(parityRoot, "current"), { throwIfNoEntry: false })).toBeUndefined()
    expect(await stat(configPath, { throwIfNoEntry: false })).toBeUndefined()
    expect(await stat(join(root, "home", ".omo", "agent", "settings.json"), { throwIfNoEntry: false })).toBeUndefined()
  })

  test("#given a deployed package path #when deployment repeats #then settings retains one parity package entry", async () => {
    // given
    const fixture = await deploymentFixture()
    const settingsPath = join(dirname(fixture.configPath), "agent", "settings.json")
    await mkdir(dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, '{"packages":["/existing/package"]}')

    // when
    await deployStandaloneParity({ ...fixture, settingsPath, overlay: "next-config" })
    await deployStandaloneParity({ ...fixture, settingsPath, overlay: "next-config" })

    // then
    expect(JSON.parse(await readFile(settingsPath, "utf8")).packages).toEqual([
      "/existing/package",
      join(fixture.parityRoot, "current", "package"),
    ])
  })

  test("#given malformed isolated settings #when deployment begins #then it restores the prior payload and config without changing settings bytes", async () => {
    // given
    const fixture = await deploymentFixture()
    const settingsPath = join(dirname(fixture.configPath), "agent", "settings.json")
    const malformed = '{"packages": [}'
    await mkdir(dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, malformed)

    // when
    const deployment = deployStandaloneParity({ ...fixture, settingsPath, overlay: "next-config" })

    // then
    await expect(deployment).rejects.toThrow("isolated beta settings must be an object")
    expect(await readFile(join(fixture.parityRoot, "current", "previous.txt"), "utf8")).toBe("previous")
    expect(await readFile(fixture.configPath, "utf8")).toBe("previous-config")
    expect(await readFile(settingsPath, "utf8")).toBe(malformed)
  })

  test("#given a corrupt current payload after deployment #when rollback runs #then it restores the snapshot without validating current", async () => {
    // given
    const fixture = await deploymentFixture()

    // when
    await deployStandaloneParity({ ...fixture, overlay: "next-config" })
    await rm(join(fixture.parityRoot, "current"), { recursive: true, force: true })
    await rollbackStandaloneParity({ parityRoot: fixture.parityRoot, configPath: fixture.configPath })

    // then
    expect(await readFile(join(fixture.parityRoot, "current", "previous.txt"), "utf8")).toBe("previous")
    expect(await readFile(fixture.configPath, "utf8")).toBe("previous-config")
  })

  test("#given settings with protected fields and an existing package #when deployment activates parity #then only packages changes and rollback restores its original bytes", async () => {
    // given
    const fixture = await deploymentFixture()
    const settingsPath = join(dirname(fixture.configPath), "agent", "settings.json")
    const originalSettings = '{\n  "auth": { "token": "protected" },\n  "packages": ["/existing/package"],\n  "sessions": { "keep": true }\n}\n'
    await mkdir(dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, originalSettings)

    // when
    await deployStandaloneParity({ ...fixture, settingsPath, overlay: "next-config" })

    // then
    const deployedSettings = await readFile(settingsPath, "utf8")
    expect(deployedSettings).toContain('"auth": { "token": "protected" }')
    expect(deployedSettings).toContain('"sessions": { "keep": true }')
    expect(JSON.parse(deployedSettings).packages).toEqual([
      "/existing/package",
      join(fixture.parityRoot, "current", "package"),
    ])

    // when
    await rollbackStandaloneParity({ parityRoot: fixture.parityRoot, configPath: fixture.configPath, settingsPath })

    // then
    expect(await readFile(settingsPath, "utf8")).toBe(originalSettings)
  })

  test("#given an interrupted journal #when another deployment begins #then restores the interrupted snapshot before creating the next rollback point", async () => {
    // given
    const fixture = await deploymentFixture()
    const interruptedBackup = join(fixture.parityRoot, "backups", "interrupted")
    await mkdir(join(interruptedBackup, "payload"), { recursive: true })
    await writeFile(join(interruptedBackup, "payload", "previous.txt"), "recovered")
    await writeFile(join(interruptedBackup, "omo.jsonc"), "recovered-config")
    await writeFile(join(fixture.parityRoot, "current", "previous.txt"), "partial")
    await writeFile(fixture.configPath, "partial-config")
    await writeFile(join(fixture.parityRoot, "journal.json"), JSON.stringify({ version: 1, backupRoot: interruptedBackup, status: "in_progress" }))

    // when
    await deployStandaloneParity({ ...fixture, overlay: "next-config" })
    await rollbackStandaloneParity({ parityRoot: fixture.parityRoot, configPath: fixture.configPath })

    // then
    expect(await readFile(join(fixture.parityRoot, "current", "previous.txt"), "utf8")).toBe("recovered")
    expect(await readFile(fixture.configPath, "utf8")).toBe("recovered-config")
  })

  test("#given an invalid staged manifest #when deployment begins #then leaves prior isolated state untouched", async () => {
    // given
    const fixture = await deploymentFixture()
    await writeFile(join(fixture.stagingRoot, "manifest.json"), "{}")

    // when
    const deployment = deployStandaloneParity({ ...fixture, overlay: "next-config" })

    // then
    await expect(deployment).rejects.toThrow()
    expect(await readFile(join(fixture.parityRoot, "current", "previous.txt"), "utf8")).toBe("previous")
    expect(await readFile(fixture.configPath, "utf8")).toBe("previous-config")
  })

  test("#given targets outside the isolated beta root #when deployment begins #then rejects protected-path writes", async () => {
    // given
    const fixture = await deploymentFixture()

    // when
    const deployment = deployStandaloneParity({
      ...fixture,
      parityRoot: join(dirname(fixture.parityRoot), "not-standalone-parity"),
      overlay: "next-config",
    })

    // then
    await expect(deployment).rejects.toThrow("payload root is not standalone-parity")
  })

  test("#given a symlinked beta-home segment #when deployment begins #then rejects the filesystem escape", async () => {
    // given
    const fixture = await deploymentFixture()
    const betaRoot = dirname(fixture.parityRoot)
    const outsideHome = await mkdtemp(join(tmpdir(), "omo-standalone-outside-home-"))
    roots.push(outsideHome)
    await rm(join(betaRoot, "home"), { recursive: true, force: true })
    await symlink(outsideHome, join(betaRoot, "home"))

    // when
    const deployment = deployStandaloneParity({ ...fixture, overlay: "next-config" })

    // then
    await expect(deployment).rejects.toThrow("symlink target rejected")
  })
})

async function deploymentFixture(): Promise<{
  readonly stagingRoot: string
  readonly parityRoot: string
  readonly configPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), "omo-standalone-deploy-boundary-"))
  roots.push(root)
  const stagingRoot = join(root, "staging")
  const parityRoot = join(root, "standalone-parity")
  const configPath = join(root, "home", ".omo", "omo.jsonc")
  await writeManifest(stagingRoot)
  await mkdir(join(parityRoot, "current"), { recursive: true })
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(join(parityRoot, "current", "previous.txt"), "previous")
  await writeFile(configPath, "previous-config")
  return { stagingRoot, parityRoot, configPath }
}

async function writeManifest(stagingRoot: string): Promise<void> {
  await mkdir(stagingRoot, { recursive: true })
  await writeFile(join(stagingRoot, "manifest.json"), '{"version":1,"generatedAt":"2026-09-19T00:00:00.000Z","skills":[],"commands":[],"mcps":[],"instructionsPath":"instructions.md","routingPath":"routing.json","files":{}}')
}
