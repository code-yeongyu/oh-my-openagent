import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createLiveHostChildren, RpcHostRunner, RpcProcessRunner, type RpcRunnerSpec } from "@oh-my-opencode/senpi-task"

import {
  buildProcessChildRunner,
  buildRespawnRunner,
  createInheritedExtensionsResolver,
  type RunnerBuildContext,
  TASK_CHILD_UI_ONLY_TOOL_NAMES,
} from "./engine-runners"
import { TaskRuntimeContext } from "./runtime-context"
import type { TaskHostRouting } from "./shard-routing"

// Characterization of today's omo task runners (plan behaviour E1). These pins describe what the
// task engine does now; a later change that moves any of them is a behaviour change, not a refactor.

// No start below reaches a host: every runner start is stubbed on the prototype.
const STUBBED_HOST_ROUTING: TaskHostRouting = {
  ensureDaemon: () => Promise.reject(new Error("the runner start is stubbed; nothing is ensured")),
  shardResolver: () => {
    throw new Error("the runner start is stubbed; no shard is resolved")
  },
  ownHostSocket: () => undefined,
  insideHost: () => false,
  probeHost: () => Promise.resolve(undefined),
  onNotice: () => undefined,
  shardEvents: {},
  liveChildren: createLiveHostChildren({}),
  storeDir: "/state",
}

const restores: (() => void)[] = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

function buildContext(overrides: Partial<Omit<RunnerBuildContext, "settings">> & { readonly settings?: Record<string, unknown> } = {}): RunnerBuildContext {
  const { settings, ...rest } = overrides
  return {
    runtime: new TaskRuntimeContext("/project"),
    sharedParentTools: () => [],
    settings: OmoTaskSettingsSchema.parse(settings ?? {}),
    agentDir: "/agent",
    env: {},
    ...rest,
  }
}

function rpcSpec(overrides: Partial<RpcRunnerSpec> = {}): RpcRunnerSpec {
  return {
    task_id: "st_characterize",
    cwd: "/project",
    state_dir: "/state/children/st_characterize",
    prompt: "characterize",
    depth: 1,
    root_session_id: "parent",
    ...overrides,
  }
}

function captureProcessStarts(): RpcRunnerSpec[] {
  const seen: RpcRunnerSpec[] = []
  const stopped = new Error("stop before spawning")
  const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation((spec: RpcRunnerSpec) => {
    seen.push(spec)
    return Promise.reject(stopped)
  })
  restores.push(() => start.mockRestore())
  return seen
}

describe("E1 characterization: task child UI-only tools", () => {
  test("#given the task runner wiring #when the UI-only tool list is read #then it is exactly the two question tools in this order", () => {
    // given / when / then
    expect([...TASK_CHILD_UI_ONLY_TOOL_NAMES]).toEqual(["request_user_input", "ask_user_question"])
  })
})

describe("E1 characterization: which runner a process child gets", () => {
  test("#given default task settings #when they are parsed #then the process runner setting is host", () => {
    // given / when / then
    expect(OmoTaskSettingsSchema.parse({}).process_runner).toBe("host")
  })

  test.each([
    { name: "host on linux with routing", settings: { process_runner: "host" }, platform: "linux", routing: true, expected: RpcHostRunner },
    { name: "host on darwin with routing", settings: { process_runner: "host" }, platform: "darwin", routing: true, expected: RpcHostRunner },
    { name: "default settings on linux with routing", settings: {}, platform: "linux", routing: true, expected: RpcHostRunner },
    { name: "host on win32 without routing", settings: { process_runner: "host" }, platform: "win32", routing: false, expected: RpcProcessRunner },
    { name: "host on win32 with routing", settings: { process_runner: "host" }, platform: "win32", routing: true, expected: RpcProcessRunner },
    { name: "child-process on linux without routing", settings: { process_runner: "child-process" }, platform: "linux", routing: false, expected: RpcProcessRunner },
    { name: "child-process on darwin with routing", settings: { process_runner: "child-process" }, platform: "darwin", routing: true, expected: RpcProcessRunner },
  ] as const)("#given $name #when the process child runner is built #then it is the expected runner class", ({ settings, platform, routing, expected }) => {
    // given
    const context = buildContext({ settings, platform, ...(routing ? { hostRouting: STUBBED_HOST_ROUTING } : {}) })

    // when
    const runner = buildProcessChildRunner(context)

    // then
    expect(runner).toBeInstanceOf(expected)
  })

  test("#given the host runner on a non-win32 platform without shard routing #when the process child runner is built #then it throws the routing error", () => {
    // given
    const context = buildContext({ settings: { process_runner: "host" }, platform: "linux" })

    // when / then
    expect(() => buildProcessChildRunner(context)).toThrow("omo-senpi task host runner built without the session's shard routing")
  })
})

describe("E1 characterization: respawn runner launch spec", () => {
  test("#given a spec without extensions #when the respawn runner starts it #then the inherited extensions resolver fills them", async () => {
    // given
    const seen = captureProcessStarts()
    let resolverCalls = 0
    const runner = buildRespawnRunner(buildContext({
      settings: { process_runner: "child-process" },
      resolveInheritedExtensions: () => {
        resolverCalls += 1
        return Promise.resolve(["/inherited/a.ts", "/inherited/b.ts"])
      },
    }))

    // when
    await expect(runner.start(rpcSpec())).rejects.toThrow("stop before spawning")

    // then
    expect(resolverCalls).toBe(1)
    expect(seen.map((spec) => spec.extensions)).toEqual([["/inherited/a.ts", "/inherited/b.ts"]])
  })

  test("#given a spec that already carries extensions #when the respawn runner starts it #then they pass through and the resolver is not consulted", async () => {
    // given
    const seen = captureProcessStarts()
    let resolverCalls = 0
    const runner = buildRespawnRunner(buildContext({
      settings: { process_runner: "child-process" },
      resolveInheritedExtensions: () => {
        resolverCalls += 1
        return Promise.resolve(["/inherited/a.ts"])
      },
    }))

    // when
    await expect(runner.start(rpcSpec({ extensions: ["/explicit.ts"] }))).rejects.toThrow("stop before spawning")

    // then
    expect(resolverCalls).toBe(0)
    expect(seen.map((spec) => spec.extensions)).toEqual([["/explicit.ts"]])
  })

  test("#given exclude_models #when the respawn runner starts a spec with a fallback chain #then excluded selectors are dropped in order", async () => {
    // given
    const seen = captureProcessStarts()
    const runner = buildRespawnRunner(buildContext({
      settings: { process_runner: "child-process" },
      excludeModels: ["zai/glm-5.3"],
      resolveInheritedExtensions: () => Promise.resolve([]),
    }))

    // when
    await expect(runner.start(rpcSpec({ fallbackModels: ["openai/gpt-5.6-sol:high", "zai/glm-5.3", "kimi-coding/kimi-k3"] }))).rejects.toThrow("stop before spawning")

    // then
    expect(seen.map((spec) => spec.fallbackModels)).toEqual([["openai/gpt-5.6-sol:high", "kimi-coding/kimi-k3"]])
  })
})

describe("E1 characterization: inherited extensions resolver", () => {
  function withArgv(argv: string[]): void {
    const original = process.argv
    process.argv = argv
    restores.push(() => {
      process.argv = original
    })
  }

  test("#given no loaded extension paths #when resolving #then only argv entries return and packages are never listed", async () => {
    // given
    withArgv(["bun", "omo", "-e", "/argv/plugin", "--extension", "/argv/other.ts"])
    let listed = 0
    const resolve = createInheritedExtensionsResolver(buildContext({
      listInstalledPackageRoots: () => {
        listed += 1
        return ["/packages/one"]
      },
    }))

    // when
    const inherited = await resolve()

    // then
    expect(inherited).toEqual(["/argv/plugin", "/argv/other.ts"])
    expect(listed).toBe(0)
  })

  test("#given loaded package extension paths #when resolving twice #then argv stays first, package paths follow, and packages are listed on every call", async () => {
    // given
    withArgv(["bun", "omo", "-e", "/argv/plugin"])
    const runtime = new TaskRuntimeContext("/project")
    runtime.captureFrom({
      loadedExtensionPaths: [
        "/argv/plugin/extensions/omo.js",
        "/packages/one/extensions/provider.ts",
        "/packages/one/extensions/provider.ts",
        "/agent/extensions/local.ts",
        "<inline:virtual>",
      ],
    })
    let listed = 0
    const resolve = createInheritedExtensionsResolver(buildContext({
      runtime,
      listInstalledPackageRoots: () => {
        listed += 1
        return ["/packages/one"]
      },
    }))

    // when
    const first = await resolve()
    const second = await resolve()

    // then
    expect(first).toEqual(["/argv/plugin", "/packages/one/extensions/provider.ts"])
    expect(second).toEqual(first)
    expect(listed).toBe(2)
  })

  test("#given package discovery throws #when resolving #then the child inherits argv entries only", async () => {
    // given
    withArgv(["bun", "omo", "-e", "/argv/plugin"])
    const runtime = new TaskRuntimeContext("/project")
    runtime.captureFrom({ loadedExtensionPaths: ["/packages/one/extensions/provider.ts"] })
    const resolve = createInheritedExtensionsResolver(buildContext({
      runtime,
      listInstalledPackageRoots: () => {
        throw new Error("package discovery unavailable")
      },
    }))

    // when
    const inherited = await resolve()

    // then
    expect(inherited).toEqual(["/argv/plugin"])
  })
})
