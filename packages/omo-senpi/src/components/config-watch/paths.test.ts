/// <reference types="bun-types" />

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  findProjectConfigPathsFarthestFirst,
  resolveOmoConfigPaths,
  resolveUserOmoConfigDirectory,
} from "@oh-my-opencode/omo-config-core"

import {
  isSenpiRestrictedTarget,
  resolveOmoConfigWatchTargetResolution,
  resolveOmoConfigWatchTargets,
  type OmoConfigWatchTarget,
} from "./paths"

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
    const userConfigDirectory = join(fixture.homeDir, ".omo")
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

    expect(resolveUserOmoConfigDirectory(fixtureEnv(fixture))).toBe(userConfigDirectory)
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
    expect(targetFor(targets, userConfigDirectory, "/omo.jsonc")).toBe(true)
    expect(targetFor(targets, join(fixture.workDir, ".omo"), "/omo.json")).toBe(true)
    expect(targetFor(targets, join(fixture.projectDir, ".omo"), "/omo.jsonc")).toBe(true)
    expect(targetFor(targets, join(fixture.cwd, ".omo"), "/omo.jsonc")).toBe(true)
    expect(targets.filter((target) => target.filterGlobs.includes("/.omo")).map((target) => target.path)).toEqual([
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
      (target) => target.path === fixture.projectDir && target.filterGlobs.includes("/.omo"),
    )

    // A new invalid config is rejected without a reload, so the original ancestor
    // watch must also receive the later child-file fix that clears the rejection.
    expect(creationTarget?.filterGlobs).toEqual(["/.omo", "/.omo/omo.jsonc", "/.omo/omo.json"])
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

    expect(targetFor(targets, join(fixture.projectDir, ".omo"), "/omo.jsonc")).toBe(false)
    expect(targetFor(targets, fixture.projectDir, "/.omo")).toBe(true)
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

    expect(targetFor(targets, omoDirectory, "/omo.jsonc")).toBe(true)
    expect(targetFor(targets, omoDirectory, "/omo.json")).toBe(true)
  })

  it("#given the default install layout #when resolving targets #then watches ~/.omo config and reports discovery as watched", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.homeDir, ".omo")
    mkdirSync(join(userConfigDirectory, "agent"), { recursive: true })
    writeFileSync(join(userConfigDirectory, "agent", "settings.json"), "{}")

    const resolution = resolveOmoConfigWatchTargetResolution({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    expect(resolveUserOmoConfigDirectory({ HOME: fixture.homeDir })).toBe(userConfigDirectory)
    expect(resolution.userConfigCreationDiscovery).toBe("watched")
    expect(resolution.userConfigCreationWatched).toBe(true)
    expect(targetFor(resolution.targets, userConfigDirectory, "/omo.jsonc")).toBe(true)
    expect(targetFor(resolution.targets, userConfigDirectory, "/omo.json")).toBe(true)
  })

  it("#given cwd at HOME with the default install layout #when resolving targets #then retains the ~/.omo config target", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.homeDir, ".omo")
    mkdirSync(join(userConfigDirectory, "agent"), { recursive: true })
    writeFileSync(join(userConfigDirectory, "agent", "settings.json"), "{}")

    const resolution = resolveOmoConfigWatchTargetResolution({
      cwd: fixture.homeDir,
      env: { HOME: fixture.homeDir },
      platform: "linux",
    })

    expect(resolution.targets.length).toBeGreaterThan(0)
    expect(targetFor(resolution.targets, userConfigDirectory, "/omo.jsonc")).toBe(true)
  })

  it("#given a missing ~/.omo user config directory #when resolving targets #then emits a basename-anchored HOME creation target and watches discovery", () => {
    const fixture = createFixture()
    const env = { HOME: fixture.homeDir }

    const resolution = resolveOmoConfigWatchTargetResolution({
      cwd: fixture.cwd,
      env,
      platform: "linux",
    })

    expect(resolution.targets.some((target) => target.path === fixture.homeDir && target.filterGlobs.includes("/.omo"))).toBe(true)
    expect(resolution.targets.find((target) => target.path === fixture.homeDir && target.filterGlobs.includes("/.omo"))?.filterGlobs).toEqual([
      "/.omo",
      "/.omo/omo.jsonc",
      "/.omo/omo.json",
    ])
    expect(resolution.userConfigCreationDiscovery).toBe("watched")
    expect(resolution.userConfigCreationWatched).toBe(true)
  })

  it("#given the senpi agent dir defaulting under HOME #when resolving targets #then keeps safe config globs and drops protected intersections", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.homeDir, ".omo")
    mkdirSync(join(userConfigDirectory, "agent"), { recursive: true })
    writeFileSync(join(userConfigDirectory, "agent", "settings.json"), "{}")
    const env = { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome }
    const protectedPaths = [
      join(userConfigDirectory, "agent", "auth.json"),
      join(userConfigDirectory, "agent", "sessions"),
      join(userConfigDirectory, "agent", "logs"),
    ]

    const targets = resolveOmoConfigWatchTargets({ cwd: fixture.cwd, env, platform: "linux" })

    expect(targetFor(targets, userConfigDirectory, "/omo.jsonc")).toBe(true)
    expect(targetFor(targets, fixture.homeDir, "/.omo")).toBe(false)
    for (const target of targets) {
      for (const protectedPath of protectedPaths) {
        for (const glob of target.filterGlobs) {
          const globPath = resolve(target.path, glob.slice(1))
          expect(globPath === protectedPath || globPath.startsWith(`${protectedPath}/`)).toBe(false)
          expect(protectedPath === globPath || protectedPath.startsWith(`${globPath}/`)).toBe(false)
        }
      }
    }
    expect(targets.filter((target) => target.filterGlobs.includes("/.omo")).map((target) => target.path)).toEqual([
      fixture.cwd,
      fixture.projectDir,
      fixture.workDir,
    ])
  })

  it("#given protected paths #when checking targets #then rejects unanchored and protected-resolving globs but permits safe anchored globs", () => {
    const fixture = createFixture()
    const agentDir = join(fixture.homeDir, ".omo", "agent")
    const protectedPaths = [join(agentDir, "auth.json"), join(agentDir, "sessions"), join(agentDir, "logs")]
    const target = (filterGlobs: string[]): OmoConfigWatchTarget => ({ path: fixture.homeDir, kind: "dir", filterGlobs })

    expect(isSenpiRestrictedTarget(target([".omo"]), protectedPaths)).toBe(true)
    expect(isSenpiRestrictedTarget(target(["/.omo/agent/auth.json"]), protectedPaths)).toBe(true)
    expect(isSenpiRestrictedTarget({ path: join(fixture.homeDir, ".omo"), kind: "dir", filterGlobs: ["/omo.jsonc", "/omo.json"] }, protectedPaths)).toBe(false)
    expect(isSenpiRestrictedTarget({ path: agentDir, kind: "dir", filterGlobs: ["settings.json"] }, protectedPaths)).toBe(true)
  })

  it("#given an explicit SENPI_CODING_AGENT_DIR under HOME #when resolving targets #then drops only targets intersecting its protected paths", () => {
    const fixture = createFixture()
    const agentDir = join(fixture.homeDir, "custom-agent")
    const env = { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome, SENPI_CODING_AGENT_DIR: agentDir }

    const targets = resolveOmoConfigWatchTargets({ cwd: fixture.cwd, env, platform: "linux" })

    expect(targetFor(targets, fixture.homeDir, "/.omo")).toBe(true)
    expect(targets.some((target) => target.path === agentDir)).toBe(false)
    expect(targetFor(targets, fixture.workDir, "/.omo")).toBe(true)
  })

  it("#given ancestor creation targets #when resolving targets #then every creation glob is root-anchored", () => {
    const fixture = createFixture()
    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })
    const creationTargets = targets.filter((target) => target.filterGlobs.some((glob) => glob.endsWith(".omo")))
    expect(creationTargets.length).toBeGreaterThan(0)
    for (const target of creationTargets) {
      expect(target.filterGlobs).toEqual(["/.omo", "/.omo/omo.jsonc", "/.omo/omo.json"])
    }
  })

  it("#given the user config parent creation target #when resolving targets #then its glob is root-anchored", () => {
    const fixture = createFixture()
    const env = { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome, SENPI_CODING_AGENT_DIR: fixture.agentDir }
    const targets = resolveOmoConfigWatchTargets({ cwd: fixture.cwd, env, platform: "linux" })
    const userCreationTarget = targets.find((target) => target.path === fixture.homeDir && target.filterGlobs.includes("/.omo"))
    expect(userCreationTarget?.filterGlobs).toEqual(["/.omo", "/.omo/omo.jsonc", "/.omo/omo.json"])
  })

  it("#given an existing .omo directory holding runtime state #when resolving targets #then its config globs are root-anchored so the subtree is not scanned", () => {
    const fixture = createFixture()
    writeProjectConfig(fixture.projectDir)
    const omoDirectory = join(fixture.projectDir, ".omo")
    mkdirSync(join(omoDirectory, "senpi-task", "children", "st_abc"), { recursive: true })
    writeFileSync(join(omoDirectory, "senpi-task", "children", "st_abc", "transcript.jsonl"), "{}\n")

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
    })
    const configTarget = targets.find((target) => target.path === omoDirectory)
    expect(configTarget?.filterGlobs).toEqual(["/omo.jsonc", "/omo.json"])
  })

  it("#given a Plan 9 project filesystem #when resolving targets #then skips project and ancestor watches while retaining native user config", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.homeDir, ".omo")
    mkdirSync(userConfigDirectory, { recursive: true })
    writeProjectConfig(fixture.projectDir)

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
      resolveFileSystemType: (path) => path === userConfigDirectory ? 0x01021994 : 0x01021997,
    })

    expect(targetFor(targets, userConfigDirectory, "/omo.jsonc")).toBe(true)
    expect(targets.some((target) => target.path === fixture.projectDir && target.filterGlobs.includes("/.omo"))).toBe(false)
    expect(targets.some((target) => target.filterGlobs.includes("/.omo"))).toBe(false)
  })

  it("#given a native project filesystem #when resolving targets #then preserves project and ancestor watches", () => {
    const fixture = createFixture()
    writeProjectConfig(fixture.projectDir)

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
      resolveFileSystemType: () => 0x01021994,
    })

    expect(targetFor(targets, join(fixture.projectDir, ".omo"), "/omo.jsonc")).toBe(true)
    expect(targets.some((target) => target.filterGlobs.includes("/.omo"))).toBe(true)
  })

  it("#given a Plan 9 user config filesystem #when resolving targets #then skips the user config watch", () => {
    const fixture = createFixture()
    const userConfigDirectory = join(fixture.homeDir, ".omo")
    mkdirSync(userConfigDirectory, { recursive: true })

    const targets = resolveOmoConfigWatchTargets({
      cwd: fixture.cwd,
      env: fixtureEnv(fixture),
      platform: "linux",
      resolveFileSystemType: () => 0x01021997,
    })

    expect(targetFor(targets, userConfigDirectory, "/omo.jsonc")).toBe(false)
    expect(targets.some((target) => target.filterGlobs.includes("/.omo"))).toBe(false)
  })
})

process.on("beforeExit", () => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
