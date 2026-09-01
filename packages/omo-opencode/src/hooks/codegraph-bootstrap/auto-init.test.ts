/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  clearCodegraphBootstrapProjectsForTesting,
  createCodegraphBootstrapHook,
  type CodegraphBootstrapDeps,
  type CodegraphBootstrapEventInput,
} from "./index"

function createDeps(
  events: string[],
  overrides: Partial<CodegraphBootstrapDeps> = {},
  scheduledTasks: Promise<void>[] = [],
): CodegraphBootstrapDeps {
  return {
    buildEnv: () => ({ CODEGRAPH_INSTALL_DIR: "/home/test/.omo/codegraph", CODEGRAPH_NO_DOWNLOAD: "1", CODEGRAPH_TELEMETRY: "0", DO_NOT_TRACK: "1" }),
    ensureGitignored: (projectRoot) => {
      events.push(`gitignore:${projectRoot}`)
      return true
    },
    excludeProject: () => ({ excluded: false }),
    ensureProvisioned: async () => {
      events.push("provision")
      return { binPath: "/bin/codegraph", provisioned: true }
    },
    log: (message) => {
      events.push(`log:${message}`)
    },
    prepareWorkspace: (projectRoot) => {
      events.push(`prepare:${projectRoot}`)
      return {
        dataDir: `${projectRoot}/.codegraph`,
        dataRoot: "/home/test/.omo/codegraph",
        linked: false,
        mode: "in-project",
        projectLink: `${projectRoot}/.codegraph`,
      }
    },
    resolveCommand: () => ({ argsPrefix: [], command: "/bin/codegraph", exists: true, source: "path" }),
    runCommand: async (_projectRoot, command, args) => {
      events.push(`run:${command}:${args.join(" ")}`)
      if (args[0] === "status") return { exitCode: 0, stdout: "initialized", timedOut: false }
      return { exitCode: 0, stdout: "", timedOut: false }
    },
    nodeSupport: () => ({ major: 22, override: false, supported: true }),
    schedule: (task) => {
      events.push("scheduled")
      const scheduledTask = task()
      scheduledTasks.push(scheduledTask)
      void scheduledTask
    },
    ...overrides,
  }
}

function sessionCreatedInput(id: string): CodegraphBootstrapEventInput {
  return { event: { type: "session.created", properties: { info: { id } } } }
}

describe("codegraph-bootstrap auto_init", () => {
  let workspace: string

  afterEach(() => {
    clearCodegraphBootstrapProjectsForTesting()
    if (workspace) rmSync(workspace, { recursive: true, force: true })
  })

  // #given auto_init is false and .codegraph does not exist
  // #when bootstrap runs
  // #then it should skip bootstrap without creating .codegraph
  test("#given auto_init is false and .codegraph does not exist #when bootstrap runs #then it skips without creating .codegraph", async () => {
    // given
    workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-auto-init-skip-"))
    expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
    const events: string[] = []
    const scheduledTasks: Promise<void>[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: false, auto_provision: false, enabled: true },
      createDeps(events, {}, scheduledTasks),
    )

    // when
    hook.event?.(sessionCreatedInput("ses_auto_init_skip"))
    await Promise.all(scheduledTasks)

    // then
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(false)
    expect(events.some((event) => event.startsWith("run:"))).toBe(false)
    expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
  })

  // #given auto_init is false and .codegraph already exists
  // #when bootstrap runs
  // #then it should continue with sync (prepareWorkspace is called)
  test("#given auto_init is false and .codegraph already exists #when bootstrap runs #then it continues with sync", async () => {
    // given
    workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-auto-init-existing-"))
    mkdirSync(join(workspace, ".codegraph"), { recursive: true })
    expect(existsSync(join(workspace, ".codegraph"))).toBe(true)
    const events: string[] = []
    const scheduledTasks: Promise<void>[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: false, auto_provision: false, enabled: true },
      createDeps(events, {}, scheduledTasks),
    )

    // when
    hook.event?.(sessionCreatedInput("ses_auto_init_existing"))
    await Promise.all(scheduledTasks)

    // then
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(true)
  })

  // #given auto_init is true (default) and .codegraph does not exist
  // #when bootstrap runs
  // #then it should proceed with bootstrap (current behavior preserved)
  test("#given auto_init is true and .codegraph does not exist #when bootstrap runs #then it proceeds with bootstrap", async () => {
    // given
    workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-auto-init-true-"))
    expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
    const events: string[] = []
    const scheduledTasks: Promise<void>[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: true, auto_provision: false, enabled: true },
      createDeps(events, {}, scheduledTasks),
    )

    // when
    hook.event?.(sessionCreatedInput("ses_auto_init_true"))
    await Promise.all(scheduledTasks)

    // then
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(true)
  })

  // #given auto_init is false and auto_provision defaults to true
  // #when bootstrap runs and .codegraph does not exist
  // #then ensureProvisioned should NOT be called (minimal side effects)
  test("#given auto_init false with default auto_provision and no .codegraph #when bootstrap runs #then ensureProvisioned is not called", async () => {
    // given
    workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-auto-init-no-provision-"))
    expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
    const events: string[] = []
    const scheduledTasks: Promise<void>[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: false, enabled: true },
      createDeps(events, {}, scheduledTasks),
    )

    // when
    hook.event?.(sessionCreatedInput("ses_no_provision"))
    await Promise.all(scheduledTasks)

    // then
    expect(events).not.toContain("provision")
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(false)
    expect(events.some((event) => event.startsWith("run:"))).toBe(false)
  })
})
