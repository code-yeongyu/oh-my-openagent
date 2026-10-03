import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  buildRpcSpawn,
  createRpcManagedRunner,
  createTaskTool,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type RpcRunnerSpec,
  type RunnerOutcome,
  type TaskToolDetails,
} from "@oh-my-opencode/senpi-task"

import { buildChildContext } from "../../../../senpi-task/src/runners/rpc-host/session-context"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine, type TaskEngine, type TaskRunnerFactories } from "./engine"
import { createTeamService } from "./team-service"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

// #9036: a process child boots its own task engine. Its depth must come from the launch the parent
// made (per-child env, or the daemon session context), so a grandchild spawn is refused at the
// configured max_depth instead of reading as a fresh top-level child forever.

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-depth-ancestry-"))
  tempRoots.push(dir)
  return dir
}

const MOCK_MODEL = "omo-mock/mock-1"

function configFor(cwd: string, task: Record<string, unknown> = {}): OmoConfig {
  const loaded = loadOmoConfig({ cwd }).config
  return {
    ...loaded,
    task: { ...loaded.task, ...task } as OmoConfig["task"],
    agents: { worker: { description: "delegating worker", model: MOCK_MODEL, execution_mode: "process" } },
  }
}

function neverSettlingHandle(spec: ManagedStartSpec): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    sessionId: undefined,
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForOutcome: () => new Promise<RunnerOutcome>(() => {}),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
}

type Launches = { readonly rpc: RpcRunnerSpec[]; readonly managed: ManagedStartSpec[] }

// The REAL managed->rpc mapping (createRpcManagedRunner) feeds a capturing rpc runner, so the spec a
// process child is launched with is exactly what production hands the per-child spawn and the daemon.
function capturingFactories(launches: Launches): TaskRunnerFactories {
  const inProcess: ManagedRunner = {
    start: (spec) => {
      launches.managed.push(spec)
      return Promise.resolve(neverSettlingHandle(spec))
    },
  }
  const process = createRpcManagedRunner({
    start: (spec) => {
      launches.rpc.push(spec)
      return Promise.reject(new Error("capture only: no real child process in this test"))
    },
  })
  return { inProcess: () => inProcess, process: () => process }
}

function compose(pi: FakeExtensionAPI, cwd: string, omoConfig: OmoConfig, launches: Launches, env: NodeJS.ProcessEnv): TaskEngine {
  return composeTaskEngine({ pi, omoConfig, cwd, sharedParentTools: () => [], runnerFactories: capturingFactories(launches), env })
}

async function spawnWorker(engine: TaskEngine, cwd: string, sessionId: string): Promise<TaskToolDetails> {
  const tool = createTaskTool(engine.taskToolDeps(() => ({ invokedSkills: new Set<string>() }) as never))
  const result = await tool.execute(
    "call-1",
    { prompt: "Delegate this further.", subagent_type: "worker", model: MOCK_MODEL, run_in_background: true, load_skills: [] },
    undefined,
    undefined,
    { cwd, sessionManager: { getSessionId: () => sessionId } } as never,
  )
  return result.details
}

async function launchChild(task: Record<string, unknown> = {}): Promise<{ readonly spec: RpcRunnerSpec; readonly cwd: string; readonly config: OmoConfig }> {
  const cwd = tempProject()
  const config = configFor(cwd, task)
  const launches: Launches = { rpc: [], managed: [] }
  const parent = compose(new FakeExtensionAPI(), cwd, config, launches, {})
  await spawnWorker(parent, cwd, "root-session")
  const spec = launches.rpc[0]
  if (spec === undefined) throw new Error("the parent never launched its process child")
  return { spec, cwd, config }
}

function daemonChildPi(spec: RpcRunnerSpec): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  Object.defineProperty(pi, "sessionContext", { value: buildChildContext(spec).context })
  return pi
}

function perChildEnv(spec: RpcRunnerSpec): NodeJS.ProcessEnv {
  return buildRpcSpawn(spec, {
    parentEnv: {},
    isBunBinary: false,
    isCompiledEngine: false,
    execPath: "/usr/bin/false",
    platform: process.platform,
    resolveRpcEntry: () => "/nonexistent/rpc-entry.js",
    resolveSenpiExecutable: () => null,
  }).env
}

describe("task depth ancestry across a process launch (#9036)", () => {
  it("#given a daemon-hosted child at depth 1 #when its model spawns another subagent #then the grandchild is refused at the default max_depth", async () => {
    // given the child session opened exactly as the daemon runner opens it
    const { spec, cwd, config } = await launchChild()
    const launches: Launches = { rpc: [], managed: [] }
    const child = compose(daemonChildPi(spec), cwd, config, launches, {})

    // when the child's own task tool spawns
    const details = await spawnWorker(child, cwd, "child-session")

    // then nothing launched and the model is told why
    expect(details.status).toBe("denied")
    expect(launches.rpc).toHaveLength(0)
    expect(launches.managed).toHaveLength(0)
  })

  it("#given a per-child process at depth 1 #when its model spawns another subagent #then the grandchild is refused at the default max_depth", async () => {
    // given the env the per-child process runner launches the child with
    const { spec, cwd, config } = await launchChild()
    const launches: Launches = { rpc: [], managed: [] }
    const child = compose(new FakeExtensionAPI(), cwd, config, launches, perChildEnv(spec))

    // when
    const details = await spawnWorker(child, cwd, "child-session")

    // then
    expect(details.status).toBe("denied")
    expect(launches.rpc).toHaveLength(0)
  })

  it("#given max_depth 2 #when a depth-1 child spawns #then the grandchild starts at depth 2 under the same root session", async () => {
    // given
    const { spec, cwd, config } = await launchChild({ max_depth: 2 })
    const launches: Launches = { rpc: [], managed: [] }
    const child = compose(daemonChildPi(spec), cwd, config, launches, {})

    // when
    await spawnWorker(child, cwd, "child-session")

    // then the grandchild launch carries its real depth and the original root
    expect(launches.rpc).toHaveLength(1)
    expect(launches.rpc[0]?.depth).toBe(2)
    expect(launches.rpc[0]?.root_session_id).toBe("root-session")
  })

  it("#given a depth-1 child session #when its workflow admits a node #then the node is refused and nothing launches", async () => {
    // given
    const { spec, cwd, config } = await launchChild()
    const launches: Launches = { rpc: [], managed: [] }
    const pi = daemonChildPi(spec)
    const child = compose(pi, cwd, config, launches, {})
    child.runtime.captureFrom({ sessionManager: { getSessionId: () => "child-session" } })
    const runtime = createDagRuntime({ pi, engine: child, logger: { info: () => {}, warn: () => {}, error: () => {} } })
    await runtime.attach()

    // when
    const started = await runtime.manager.start({
      parentSessionId: "child-session",
      rootSessionId: "root-session",
      definition: { key: "depth-9036", name: "depth 9036", nodes: [{ id: "deeper", prompt: "go deeper", subagent_type: "worker", model: MOCK_MODEL }] },
    })
    const result = await runtime.wait(started.snapshot.runId, "child-session")
    runtime.dispose()

    // then
    expect(launches.rpc).toHaveLength(0)
    expect(launches.managed).toHaveLength(0)
    expect(JSON.stringify(result)).toContain("depth_denied")
  })

  it("#given a depth-1 child session leading a team #when team_create spawns a member #then the member is refused and nothing launches", async () => {
    // given
    const { spec, cwd, config } = await launchChild()
    const launches: Launches = { rpc: [], managed: [] }
    const child = compose(daemonChildPi(spec), cwd, { ...config, categories: { quick: { model: MOCK_MODEL } } }, launches, {})
    child.runtime.captureFrom({ modelRegistry: createTeamServiceTestModelRegistry(), sessionManager: { getSessionId: () => "child-session" } })
    const service = createTeamService({
      manager: child.manager,
      destruction: child.lifecycle,
      runtime: child.runtime,
      settings: child.settings,
      omoConfig: child.omoConfig,
      cwd,
      agentNames: new Set(Object.keys(child.agents)),
      ...(child.ancestry === undefined ? {} : { ancestry: child.ancestry }),
    })

    // when
    const outcome = await service.createTeam({
      inlineSpec: { name: "depth-9036", members: [{ name: "beta", kind: "category", category: "quick", prompt: "work" }] },
    }).then((created) => JSON.stringify(created), (error: unknown) => String(error))

    // then
    expect(launches.rpc).toHaveLength(0)
    expect(launches.managed).toHaveLength(0)
    expect(outcome).toContain("max_depth")
  })

  it("#given a top-level session #when it spawns #then its child still starts at depth 1", async () => {
    // given / when
    const { spec } = await launchChild()

    // then
    expect(spec.depth).toBe(1)
    expect(spec.root_session_id).toBe("root-session")
  })
})
