import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prepareChildDirs } from "./child-dirs"
import { confinedEnv } from "./child-env"
import { planDenyLive, type DenyLivePlan } from "./plan"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { plan: DenyLivePlan; agent: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "child-dirs-"))
  roots.push(root)
  const agent = join(root, ".omo/agent")
  for (const dir of ["extensions", "rpc/keys", "cache", "gateway", "projects/p/senpi-task/children/st_x"])
    mkdirSync(join(agent, dir), { recursive: true })
  writeFileSync(join(agent, "settings.json"), "{}\n")
  writeFileSync(join(agent, "extensions/diff.js"), "live\n")
  const cwd = join(root, "project")
  mkdirSync(join(cwd, ".claude"), { recursive: true })
  const decision = planDenyLive({
    platform: "linux",
    home: root,
    agentDir: agent,
    stateDir: join(agent, "projects/p/senpi-task/children/st_x"),
    cwd,
    codeRoots: [],
    which: () => "/usr/bin/bwrap",
  })
  if (decision.kind !== "confined") throw new Error(decision.reason)
  return { plan: decision.plan, agent, cwd }
}

describe("prepareChildDirs", () => {
  test("#given a symlink the child planted where its view and tmp dirs go #when the next launch prepares them #then both are fresh real dirs again", () => {
    // given
    const { plan, agent } = fixture()
    symlinkSync(join(agent, "extensions"), plan.viewDir)
    symlinkSync(join(agent, "extensions"), plan.tmpDir)

    // when
    prepareChildDirs(plan).release()

    // then
    expect(lstatSync(plan.viewDir).isSymbolicLink()).toBe(false)
    expect(lstatSync(plan.tmpDir).isSymbolicLink()).toBe(false)
    expect(readdirSync(join(agent, "extensions"))).toEqual(["diff.js"])
  })

  test("#given a live agent dir #when the view is built #then files and folder entries are links, state folders are private and daemon keys and other tasks are absent", () => {
    // given
    const { plan, agent } = fixture()

    // when
    prepareChildDirs(plan).release()

    // then
    expect(readlinkSync(join(plan.viewDir, "settings.json"))).toBe(join(agent, "settings.json"))
    expect(lstatSync(join(plan.viewDir, "extensions")).isDirectory()).toBe(true)
    expect(readlinkSync(join(plan.viewDir, "extensions/diff.js"))).toBe(join(agent, "extensions/diff.js"))
    expect(lstatSync(join(plan.viewDir, "cache")).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(plan.viewDir, "gateway")).isSymbolicLink()).toBe(false)
    expect(existsSync(join(plan.viewDir, "rpc"))).toBe(false)
    expect(existsSync(join(plan.viewDir, "projects"))).toBe(false)
  })

  test("#given a project without .omo or .git #when a Linux launch prepares #then placeholders exist during the run and only the empty ones it created are removed after", () => {
    // given
    const { plan, cwd } = fixture()

    // when
    const dirs = prepareChildDirs(plan)
    const during = [".git", ".agents", ".mcp.json", ".claude"].map((name) => existsSync(join(cwd, name)))
    writeFileSync(join(cwd, ".agents/kept"), "user content")
    dirs.release()

    // then
    expect(during).toEqual([true, true, true, true])
    expect([".git", ".mcp.json", ".pi"].map((name) => existsSync(join(cwd, name)))).toEqual([false, false, false])
    expect(existsSync(join(cwd, ".agents/kept"))).toBe(true)
    expect(existsSync(join(cwd, ".claude"))).toBe(true)
    expect(existsSync(plan.artifactDir)).toBe(true)
  })

  test("#given a state dir that is a symlink #when preparing #then the launch is refused", () => {
    // given
    const { plan, agent } = fixture()
    rmSync(plan.stateDir, { recursive: true })
    symlinkSync(join(agent, "extensions"), plan.stateDir)

    // when / then
    expect(() => prepareChildDirs(plan)).toThrow("is not a real directory")
  })
})

describe("confinedEnv", () => {
  test("#given a parent that already sets git config entries #when the child env is built #then the fsmonitor override is appended after them and the agent dir is the view", () => {
    const { plan } = fixture()
    const env = confinedEnv(plan, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "x",
      OMO_CODING_AGENT_DIR: "/live",
    })
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_VALUE_1: "false",
      OMO_CODING_AGENT_DIR: plan.viewDir,
      SENPI_CODING_AGENT_DIR: plan.viewDir,
      TMPDIR: plan.tmpDir,
      OMO_SANDBOX: "deny-live",
    })
  })
})
