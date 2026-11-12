import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  buildRpcSpawn,
  createInProcessManagedRunner,
  createParentRegistrySessionContext,
  createRpcManagedRunner,
  InProcessRunner,
  RpcProcessRunner,
  type ManagedChildHandle,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import { composeTaskEngine } from "./engine"
import { formatTaskRow } from "./status-row-format"

const roots: string[] = []
const children: ManagedChildHandle[] = []
const rpcRunners: RpcProcessRunner[] = []
const engines: ReturnType<typeof composeTaskEngine>[] = []
const PROVIDER = "chatgpt-subscription"

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.manager.settleLaunchesForShutdown?.(20_000)
  for (const child of children.splice(0)) {
    if (child.kind === "rpc") await child.terminate?.()
    await child.dispose()
  }
  for (const runner of rpcRunners.splice(0)) await runner.settleTeardowns()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("fast inheritance through child startup (#12956)", () => {
  for (const mode of ["in-process", "process"] as const) {
    for (const scenario of ["priority", "standard", "excluded"] as const) {
      for (const target of ["category", "agent"] as const) {
        test(`#given a ${scenario} parent/alias #when a ${target} child starts ${mode} #then execution and row agree`, async () => {
          // given: real catalog, registry, planner, manager and Senpi child session.
          // No prompt is sent: staged startup is sufficient to exercise alias normalization.
          const senpi = await loadSenpiBarrel()
          const root = mkdtempSync(join(tmpdir(), "omo-fast-spawn-"))
          roots.push(root)
          const agentDir = join(root, "agent")
          mkdirSync(agentDir, { recursive: true })
          const modelRuntime = senpi.ModelRuntime.createSync({
            agentDir,
            allowModelNetwork: false,
            refreshOnCreate: false,
          })
          const registry = new senpi.ModelRegistry(modelRuntime)
          const id = target === "category" ? "gpt-6-luna" : "gpt-6-astra"
          const base = registry.find(PROVIDER, id)
          const fast = registry.find(PROVIDER, `${id}-fast`)
          if (base === undefined || fast === undefined) throw new Error("catalog pair missing")
          registry.registerProvider(PROVIDER, {
            api: "openai-codex-responses",
            apiKey: "synthetic-test-key",
            models: [base, fast],
          })
          const managed = createInProcessManagedRunner(new InProcessRunner(), (spec) => ({
            ...createParentRegistrySessionContext(() => registry)(spec),
            agentDir,
          }))
          const childEnv: Record<string, string> = {}
          for (const [name, value] of Object.entries(process.env)) {
            if (value !== undefined) childEnv[name] = value
          }
          for (const name of Object.keys(childEnv)) {
            if (
              name.startsWith("SENPI_RPC_HOST_") ||
              [
                "OMO_RPC_SOCKET",
                "SENPI_RPC_SOCKET",
                "PI_RPC_SOCKET",
                "OMO_RPC_SOCKET_PATH",
                "PI_SESSION_ID",
                "PI_SESSION_FILE",
                "PI_SESSION_CWD",
                "PI_GOAL_STORE_FILE",
                "SENPI_SESSION_FILE",
                "SENPI_PY_KERNEL_PARENT_PID",
              ].includes(name)
            )
              delete childEnv[name]
          }
          for (const name of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"])
            childEnv[name] = agentDir
          childEnv.OMO_MEMORY_HOME = join(root, "memory")
          childEnv.DO_NOT_TRACK = "1"
          const rpcRuntime = {
            isBunBinary: true,
            execPath: process.execPath,
            platform: process.platform,
            parentEnv: childEnv,
            resolveRpcEntry: () =>
              fileURLToPath(new URL("./bundle/rpc-entry.js", import.meta.resolve("@code-yeongyu/senpi/rpc-entry"))),
            resolveSenpiExecutable: () => null,
          }
          let rpcStderr = ""
          const rpc = new RpcProcessRunner({
            spawnProcess: (command, args, options) => {
              const child = spawn(command, [...args], { ...options, windowsHide: true })
              child.stderr?.on("data", (chunk) => {
                rpcStderr = `${rpcStderr}${String(chunk)}`.slice(-4_000)
              })
              return child
            },
            // Catalog probing has its own tests; this matrix observes the real child's startup.
            modelAdmission: async () => {},
            buildSpawn: (spec) => buildRpcSpawn(spec, rpcRuntime),
          })
          rpcRunners.push(rpc)
          const rpcManaged = createRpcManagedRunner(rpc)
          const engine = composeTaskEngine({
            pi: new FakeExtensionAPI(),
            omoConfig: {
              categories: { fixture: { model: `${PROVIDER}/${id}` } },
              agents: { fixture: { model: `${PROVIDER}/${id}` } },
              task: OmoTaskSettingsSchema.parse({ state_dir: join(root, "task-state") }),
              ...(scenario === "excluded" ? { exclude_models: ["*-fast"] } : {}),
            },
            cwd: root,
            sharedParentTools: () => [],
            runnerFactories: {
              inProcess: () => ({
                start: async (spec) => {
                  const staged = await managed.startStaged?.(spec)
                  if (staged === undefined) throw new Error("staged runner missing")
                  children.push(staged.child)
                  return staged.child
                },
              }),
              process: () => ({
                start: async (spec) => {
                  const child = await rpcManaged.start(spec)
                  children.push(child)
                  return child
                },
              }),
            },
          })
          engines.push(engine)
          engine.runtime.captureFrom({
            modelRegistry: registry,
            effectiveServiceTier: scenario === "standard" ? "auto" : "priority",
          })
          const observed = Promise.withResolvers<void>()
          const timer = setTimeout(
            () => observed.reject(new Error("child did not report its startup model in 25s")),
            25_000,
          )
          const unsubscribe = engine.onStoreMutation(({ record }) => {
            if (record?.effective_model !== undefined) observed.resolve()
            else if (record?.status === "error")
              observed.reject(new Error(`${record.error_message ?? "child startup failed"}\n${rpcStderr}`))
          })

          // when
          const starting = engine.manager.start({
            prompt: "Return OK.",
            parent_session_id: "parent-fast-spawn",
            depth: 1,
            execution_mode: mode,
            extensions: [fileURLToPath(new URL("./__fixtures__/fast-mode-provider.ts", import.meta.url))],
            memberEnv: childEnv,
            ...(target === "category" ? { category: "fixture" } : { subagent_type: "fixture" }),
          })
          let started: Awaited<typeof starting>
          try {
            const result = await Promise.all([starting, observed.promise])
            started = result[0]
          } finally {
            clearTimeout(timer)
            unsubscribe()
          }

          // then: distinguish the plan, engine execution tier, and the human-visible row.
          expect(started.kind).toBe("started")
          if (started.kind !== "started") throw new Error(JSON.stringify(started))
          const record = engine.manager.get(started.task_id)
          if (record === undefined) throw new Error("started task missing")
          const inherited = scenario === "priority"
          const selected = `${PROVIDER}/${id}${inherited ? "-fast" : ""}`
          expect(record.model).toBe(selected)
          expect(record.effective_model).toMatchObject({
            provider: PROVIDER,
            model_id: id,
          })
          expect(record.effective_model?.service_tier).toBe(inherited ? "priority" : undefined)
          expect(formatTaskRow(record)).toContain(selected)
          if (!inherited) expect(formatTaskRow(record)).not.toContain(`${id}-fast`)
        })
      }
    }
  }
})
