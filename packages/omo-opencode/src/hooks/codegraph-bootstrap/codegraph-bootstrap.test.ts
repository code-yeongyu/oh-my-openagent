/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { prepareCodegraphWorkspace, shouldExcludeCodegraphProject } from "@oh-my-opencode/utils"

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
      if (args[0] === "status") return { exitCode: 0, stdout: "not initialized", timedOut: false }
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

async function waitForBackground(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  clearCodegraphBootstrapProjectsForTesting()
})

describe("createCodegraphBootstrapHook", () => {
  test("#given a non-session-created event #when event fires #then it does nothing", () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook({ directory: "/repo" }, { enabled: true }, createDeps(events))

    // when
    hook.event({ event: { type: "session.idle", properties: {} } })

    // then
    expect(events).toEqual([])
  })

  test("#given codegraph is disabled #when session.created fires #then it does nothing", () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook({ directory: "/repo" }, { enabled: false }, createDeps(events))

    // when
    hook.event({ event: { type: "session.created", properties: {} } })

    // then
    expect(events).toEqual([])
  })

  test("#given session.created includes a worktree path #when it fires #then bootstrap runs once for that project", async () => {
    // given
    const events: string[] = []
    const projectRoot = resolve("/repo")
    const hook = createCodegraphBootstrapHook({ directory: "/fallback" }, { auto_provision: true, enabled: true }, createDeps(events))

    // when
    hook.event({ event: { type: "session.created", properties: { worktree: "/repo" } } })
    hook.event({ event: { type: "session.created", properties: { worktree: "/repo" } } })
    await waitForBackground()

    // then
    expect(events.filter((event) => event === `prepare:${projectRoot}`)).toHaveLength(1)
    expect(events).toContain("run:/bin/codegraph:status --json")
    expect(events).toContain("run:/bin/codegraph:init")
  })

  test("#given the scheduler holds work #when session.created fires #then the event handler returns before bootstrap work starts", async () => {
    // given
    const events: string[] = []
    const projectRoot = resolve("/repo")
    const scheduledTasks: Array<() => Promise<void>> = []
    const hook = createCodegraphBootstrapHook(
      { directory: "/repo" },
      { enabled: true },
      createDeps(events, {
        schedule: (task) => {
          events.push("scheduled")
          scheduledTasks.push(task)
        },
      }),
    )

    // when
    hook.event({ event: { type: "session.created", properties: {} } })

    // then
    expect(events).toEqual(["scheduled"])

    await scheduledTasks[0]?.()
    expect(events).toContain(`prepare:${projectRoot}`)
  })

  test("#given status says initialized #when background work runs #then it syncs instead of init", async () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: "/repo" },
      { enabled: true },
      createDeps(events, {
        runCommand: async (_projectRoot, command, args) => {
          events.push(`run:${command}:${args.join(" ")}`)
          return { exitCode: 0, stdout: JSON.stringify({ initialized: true }), timedOut: false }
        },
      }),
    )

    // when
    hook.event({ event: { type: "session.created", properties: {} } })
    await waitForBackground()

    // then
    expect(events).toContain("run:/bin/codegraph:sync")
    expect(events).not.toContain("run:/bin/codegraph:init")
  })

  test("#given binary resolution fails and auto provision fails #when background work runs #then it logs and skips without throwing", async () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: "/repo" },
      { auto_provision: true, enabled: true },
      createDeps(events, {
        ensureProvisioned: async () => ({ error: "download failed", provisioned: false }),
        resolveCommand: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
      }),
    )

    // when
    expect(() => hook.event({ event: { type: "session.created", properties: {} } })).not.toThrow()
    await waitForBackground()

    // then
    expect(events).toContain("log:[codegraph-bootstrap] CodeGraph unavailable; skipping bootstrap")
    expect(events.some((event) => event.startsWith("run:"))).toBe(false)
    expect(events.some((event) => event.startsWith("prepare:"))).toBe(false)
    expect(events.some((event) => event.startsWith("gitignore:"))).toBe(false)
  })

  test("#given a PATH CodeGraph binary but the host Node is unsupported #when background work runs #then it leaves the project untouched", async () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unsupported-node-"))
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unsupported-node-home-"))
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_provision: false, enabled: true },
      {
        log: (message) => {
          events.push(`log:${message}`)
        },
        excludeProject: () => ({ excluded: false }),
        nodeSupport: () => ({ major: 26, override: false, reason: "too-new", supported: false }),
        prepareWorkspace: (projectRoot) => prepareCodegraphWorkspace(projectRoot, { homeDir }),
        resolveCommand: () => ({ argsPrefix: [], command: "/usr/local/bin/codegraph", exists: true, source: "path" }),
        runCommand: async () => {
          throw new Error("codegraph command should not run")
        },
        schedule: (task) => {
          void task()
        },
      },
    )

    try {
      // when
      hook.event({ event: { type: "session.created", properties: { worktree: workspace } } })
      await waitForBackground()

      // then
      expect(events).toContain("log:[codegraph-bootstrap] CodeGraph unsupported on this Node runtime; skipping bootstrap")
      expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
      expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test("#given CodeGraph is missing and auto provision is enabled on unsupported Node #when background work runs #then it does not provision or mutate the project", async () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unsupported-provision-"))
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unsupported-provision-home-"))
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_provision: true, enabled: true },
      {
        ensureProvisioned: async () => {
          throw new Error("codegraph provisioning should not run")
        },
        excludeProject: () => ({ excluded: false }),
        log: (message) => {
          events.push(`log:${message}`)
        },
        nodeSupport: () => ({ major: 26, override: false, reason: "too-new", supported: false }),
        prepareWorkspace: (projectRoot) => prepareCodegraphWorkspace(projectRoot, { homeDir }),
        resolveCommand: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
        runCommand: async () => {
          throw new Error("codegraph command should not run")
        },
        schedule: (task) => {
          void task()
        },
      },
    )

    try {
      // when
      hook.event({ event: { type: "session.created", properties: { worktree: workspace } } })
      await waitForBackground()

      // then
      expect(events).toContain("log:[codegraph-bootstrap] CodeGraph unsupported on this Node runtime; skipping bootstrap")
      expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
      expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test("#given CodeGraph is unavailable and auto provisioning is disabled #when background work runs #then it leaves the project untouched", async () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unavailable-"))
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-unavailable-home-"))
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { auto_provision: false, enabled: true },
      {
        log: (message) => {
          events.push(`log:${message}`)
        },
        excludeProject: () => ({ excluded: false }),
        prepareWorkspace: (projectRoot) => prepareCodegraphWorkspace(projectRoot, { homeDir }),
        resolveCommand: () => ({ argsPrefix: [], command: "missing-codegraph", exists: false, source: "path" }),
        runCommand: async () => {
          throw new Error("codegraph command should not run")
        },
        schedule: (task) => {
          void task()
        },
      },
    )

    try {
      // when
      hook.event({ event: { type: "session.created", properties: { worktree: workspace } } })
      await waitForBackground()

      // then
      expect(events).toContain("log:[codegraph-bootstrap] CodeGraph unavailable; skipping bootstrap")
      expect(existsSync(join(workspace, ".codegraph"))).toBe(false)
      expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test("#given a dependency throws #when session.created fires #then the error is logged and never escapes", async () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: "/repo" },
      { enabled: true },
      createDeps(events, {
        prepareWorkspace: () => {
          throw new Error("prepare failed")
        },
      }),
    )

    // when
    expect(() => hook.event({ event: { type: "session.created", properties: {} } })).not.toThrow()
    await waitForBackground()

    // then
    expect(events).toContain("log:[codegraph-bootstrap] Bootstrap failed")
  })

  test("#given the project is under an excluded root #when session.created fires #then bootstrap is skipped and not scheduled", async () => {
    // given
    const events: string[] = []
    const hook = createCodegraphBootstrapHook(
      { directory: "/excluded/project" },
      { enabled: true, excluded_roots: ["/excluded"] },
      createDeps(events, { excludeProject: shouldExcludeCodegraphProject }),
    )

    // when
    hook.event({ event: { type: "session.created", properties: {} } })
    await waitForBackground()

    // then
    expect(events).not.toContain("scheduled")
    expect(events.some((event) => event.startsWith("run:"))).toBe(false)
    expect(events).toContain("log:[codegraph-bootstrap] CodeGraph project excluded; skipping bootstrap")
  })

  test("#given the real exclusion defaults #when the project lives under the OS tmpdir #then bootstrap is skipped", async () => {
    // given
    const events: string[] = []
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-excluded-"))
    const hook = createCodegraphBootstrapHook(
      { directory: workspace },
      { enabled: true },
      createDeps(events, { excludeProject: shouldExcludeCodegraphProject }),
    )

    // when
    try {
      hook.event({ event: { type: "session.created", properties: {} } })
      await waitForBackground()

      // then
      expect(events).not.toContain("scheduled")
      expect(events).toContain("log:[codegraph-bootstrap] CodeGraph project excluded; skipping bootstrap")
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })
})
