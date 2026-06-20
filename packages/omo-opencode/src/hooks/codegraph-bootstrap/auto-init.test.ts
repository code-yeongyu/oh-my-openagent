/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  clearCodegraphBootstrapProjectsForTesting,
  createCodegraphBootstrapHook,
  type CodegraphBootstrapDeps,
} from "./index"

function createDeps(events: string[], overrides: Partial<CodegraphBootstrapDeps> = {}): CodegraphBootstrapDeps {
  return {
    buildEnv: () => ({ CODEGRAPH_INSTALL_DIR: "/home/test/.omo/codegraph", CODEGRAPH_NO_DOWNLOAD: "1", CODEGRAPH_TELEMETRY: "0", DO_NOT_TRACK: "1" }),
    ensureGitignored: (projectRoot) => {
      events.push(`gitignore:${projectRoot}`)
      return true
    },
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
      void task()
    },
    ...overrides,
  }
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
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: false, auto_provision: false, enabled: true },
      createDeps(events),
    )

    // when
    hook.event?.({
      event: { type: "session.created", properties: { info: { id: "ses_auto_init_skip" } } } as never,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

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
    // Create .codegraph directory to simulate existing workspace
    const { mkdirSync } = await import("node:fs")
    mkdirSync(join(workspace, ".codegraph"), { recursive: true })
    expect(existsSync(join(workspace, ".codegraph"))).toBe(true)
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: false, auto_provision: false, enabled: true },
      createDeps(events),
    )

    // when
    hook.event?.({
      event: { type: "session.created", properties: { info: { id: "ses_auto_init_existing" } } } as never,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

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
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_init: true, auto_provision: false, enabled: true },
      createDeps(events),
    )

    // when
    hook.event?.({
      event: { type: "session.created", properties: { info: { id: "ses_auto_init_true" } } } as never,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    // then
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(true)
  })
})
