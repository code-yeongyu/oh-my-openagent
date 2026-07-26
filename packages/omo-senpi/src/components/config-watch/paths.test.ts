/// <reference types="bun-types" />

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  findProjectConfigPathsFarthestFirst,
  resolveOmoConfigPaths,
  resolveUserOmoConfigDirectory,
} from "@oh-my-opencode/omo-config-core"

import { resolveOmoConfigWatchTargetResolution, resolveOmoConfigWatchTargets } from "./paths"

const cleanupRoots: string[] = []

type Fixture = {
  readonly agentDir: string
  readonly cwd: string
  readonly homeDir: string
  readonly projectDir: string
  readonly workDir: string
  readonly xdgConfigHome: string
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-config-watch-paths-"))
  cleanupRoots.push(root)
  const homeDir = join(root, "home")
  const workDir = join(homeDir, "work")
  const projectDir = join(workDir, "project")
  const cwd = join(projectDir, "child")
  const xdgConfigHome = join(root, "xdg")
  const agentDir = join(root, "senpi-agent")
  mkdirSync(cwd, { recursive: true })
  return { agentDir, cwd, homeDir, projectDir, workDir, xdgConfigHome }
}

// Keep the senpi agent dir outside the fake HOME so existing ancestor
// assertions keep covering the full cwd-to-home walk; the restricted-target
// suite below pins the default under-HOME behavior.
function fixtureEnv(fixture: Fixture): { HOME: string; XDG_CONFIG_HOME: string; SENPI_CODING_AGENT_DIR: string } {
  return { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome, SENPI_CODING_AGENT_DIR: fixture.agentDir }
}

function writeProjectConfig(directory: string): string {
  const path = join(directory, ".omo", "omo.jsonc")
  mkdirSync(join(directory, ".omo"), { recursive: true })
  writeFileSync(path, "{}")
  return path
}

function targetFor(paths: readonly { readonly path: string; readonly filterGlobs: readonly string[] }[], path: string, filter: string): boolean {
  return paths.some((target) => target.path === path && target.filterGlobs.includes(filter))
}

describe("resolveOmoConfigWatchTargets", () => {
  it("#given nested project configs #when resolving targets #then watches user scope, every existing .omo directory, and each cwd-to-home ancestor", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.xdgConfigHome, "omo")
    mkdirSync(userConfigDirectory, { recursive: true })
    const workConfigPath = writeProjectConfig(fixture.workDir)
    const projectConfigPath = writeProjectConfig(fixture.projectDir)
    const cwdConfigPath = writeProjectConfig(fixture.cwd)

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })
    const loaderPaths = resolveOmoConfigPaths({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    expect(resolveUserOmoConfigDirectory(fixtureEnv(fixture), "linux"))
      .toBe(userConfigDirectory)
    expect(findProjectConfigPathsFarthestFirst(fixture.cwd, fixture.homeDir, {
      existsSync: (path) => [workConfigPath, projectConfigPath, cwdConfigPath].includes(path),
      readFileSync: () => "",
    })).toEqual([workConfigPath, projectConfigPath, cwdConfigPath])
    expect(loaderPaths.map((candidate) => candidate.path)).toEqual([
      join(userConfigDirectory, "omo.jsonc"),
      workConfigPath,
      projectConfigPath,
      cwdConfigPath,
    ])
    expect(targetFor(targets, userConfigDirectory, "omo.jsonc")).toBe(true)
    expect(targetFor(targets, join(fixture.workDir, ".omo"), "omo.json")).toBe(true)
    expect(targetFor(targets, join(fixture.projectDir, ".omo"), "omo.jsonc")).toBe(true)
    expect(targetFor(targets, join(fixture.cwd, ".omo"), "omo.jsonc")).toBe(true)
    expect(targets.filter((target) => target.filterGlobs.includes(".omo")).map((target) => target.path)).toEqual([
      fixture.cwd,
      fixture.projectDir,
      fixture.workDir,
      fixture.homeDir,
    ])
  })

  it("#given a newly created ancestor .omo directory #when resolving targets #then keeps watching its config files after a rejected creation", () => {
    const fixture = createFixture()

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    const creationTarget = targets.find(
      (target) => target.path === fixture.projectDir && target.filterGlobs.includes(".omo"),
    )

    // A new invalid config is rejected without a reload, so the original ancestor
    // watch must also receive the later child-file fix that clears the rejection.
    expect(creationTarget?.filterGlobs).toEqual([".omo", ".omo/omo.jsonc", ".omo/omo.json"])
  })

  it("#given a symlinked project .omo directory #when resolving targets #then ignores the symlinked config directory", () => {
    const fixture = createFixture()
    const outsideOmoDirectory = join(fixture.homeDir, "outside-omo")
    mkdirSync(outsideOmoDirectory, { recursive: true })
    writeFileSync(join(outsideOmoDirectory, "omo.jsonc"), "{}")
    symlinkSync(outsideOmoDirectory, join(fixture.projectDir, ".omo"))

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    expect(targetFor(targets, join(fixture.projectDir, ".omo"), "omo.jsonc")).toBe(false)
    expect(targetFor(targets, fixture.projectDir, ".omo")).toBe(true)
  })

  it("#given an existing project .omo directory without a config file #when resolving targets #then watches it for either omo config filename", () => {
    const fixture = createFixture()
    const omoDirectory = join(fixture.projectDir, ".omo")
    mkdirSync(omoDirectory, { recursive: true })

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    expect(targetFor(targets, omoDirectory, "omo.jsonc")).toBe(true)
    expect(targetFor(targets, omoDirectory, "omo.json")).toBe(true)
  })

  it("#given a missing user config directory with an existing parent #when resolving targets #then watches that parent for omo directory creation", () => {
    const fixture = createFixture()
    mkdirSync(fixture.xdgConfigHome, { recursive: true })

    const resolution = resolveOmoConfigWatchTargetResolution({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    expect(resolution.userConfigCreationWatched).toBe(true)
    expect(targetFor(resolution.targets, fixture.xdgConfigHome, "omo")).toBe(true)
  })

  it("#given a missing user config directory and parent #when resolving targets #then reports that user-scope creation needs a later reload", () => {
    const fixture = createFixture()

    const resolution = resolveOmoConfigWatchTargetResolution({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })

    expect(resolution.userConfigCreationWatched).toBe(false)
    expect(resolution.userConfigCreationDiscovery).toBe("reload_required")
    expect(targetFor(resolution.targets, fixture.xdgConfigHome, "omo")).toBe(false)
  })

  it("#given the senpi agent dir defaulting under HOME #when resolving targets #then drops every target covering the protected agent paths", () => {
    const fixture = createFixture()
    const env = { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome }
    const protectedPaths = [
      join(fixture.homeDir, ".senpi", "agent", "auth.json"),
      join(fixture.homeDir, ".senpi", "agent", "sessions"),
      join(fixture.homeDir, ".senpi", "agent", "logs"),
    ]

    const targets = resolveOmoConfigWatchTargets({ cwd: fixture.cwd, env, platform: "linux" })

    // The bare-HOME ancestor always covers ~/.senpi/agent, so senpi would
    // deterministically reject the registration; it must never be emitted.
    expect(targetFor(targets, fixture.homeDir, ".omo")).toBe(false)
    for (const target of targets) {
      for (const protectedPath of protectedPaths) {
        expect(target.path.startsWith(protectedPath)).toBe(false)
        expect(protectedPath.startsWith(target.path)).toBe(false)
      }
    }
    // Ancestors between cwd and HOME stay watched; only the covering target is dropped.
    expect(targets.filter((target) => target.filterGlobs.includes(".omo")).map((target) => target.path)).toEqual([
      fixture.cwd,
      fixture.projectDir,
      fixture.workDir,
    ])
  })

  it("#given an explicit SENPI_CODING_AGENT_DIR under HOME #when resolving targets #then drops the covering ancestor target", () => {
    const fixture = createFixture()
    const agentDir = join(fixture.homeDir, "custom-agent")
    const env = { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome, SENPI_CODING_AGENT_DIR: agentDir }

    const targets = resolveOmoConfigWatchTargets({ cwd: fixture.cwd, env, platform: "linux" })

    expect(targetFor(targets, fixture.homeDir, ".omo")).toBe(false)
    expect(targets.some((target) => target.path === agentDir)).toBe(false)
    expect(targetFor(targets, fixture.workDir, ".omo")).toBe(true)
  })
})

process.on("beforeExit", () => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
