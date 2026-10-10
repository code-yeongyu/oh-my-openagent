import { join } from "node:path"
import { spawn } from "node:child_process"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createInProcessManagedRunner,
  createRpcManagedRunner,
  InProcessRunner,
  RpcProcessRunner,
} from "@oh-my-opencode/senpi-task"
import type { OmoSenpiComponent } from "../../extension/types"
import { composeTaskEngine, type TaskEngine } from "../task/engine"
import { capture, permissionSession } from "./permission-event.test-support"
import { createTeamServiceTestModelRegistry } from "../task/team-service-test-model-registry"

export async function permissionOwner(sessionContext?: Readonly<Record<string, string>>) {
  let engine: TaskEngine | undefined
  const exits: Promise<void>[] = []
  const owner: OmoSenpiComponent = {
    name: "permission-test-owner",
    register(pi, ctx) {
      const cwd = pi.cwd
      if (cwd === undefined) throw new Error("Test session has no cwd")
      engine = composeTaskEngine({
        pi, cwd, env: {},
        omoConfig: { task: OmoTaskSettingsSchema.parse({
          state_dir: join(cwd, "tasks"), process_runner: "child-process", default_execution_mode: "in-process",
          max_depth: 2,
          isolation: { enabled: false },
        }) },
        sharedParentTools: () => ctx.getCapturedTools?.() ?? [],
        runnerFactories: {
          inProcess: () => createInProcessManagedRunner(new InProcessRunner({
            sharedParentTools: ctx.getCapturedTools?.() ?? [],
            createSession: async (options) => {
              const { createAgentSession } = await import("@code-yeongyu/senpi")
              await options.resourceLoader?.reload()
              const { session } = await createAgentSession(options)
              await session.bindExtensions({ mode: "rpc" })
              session.setActiveToolsByName(["computer"])
              let finalText: string | undefined
              return {
                sessionId: session.sessionId,
                async prompt(text) {
                  if (text.includes("NESTED_PERMISSION_PROBE")) {
                    const owner = engine
                    if (owner === undefined) throw new Error("Missing in-process task owner")
                    const nested = await owner.manager.start({
                      prompt: "capture", parent_session_id: session.sessionId,
                      root_session_id: owner.ancestry?.rootSessionId ?? owner.runtime.sessionId(),
                      depth: (owner.ancestry?.depth ?? 0) + 2, execution_mode: "process", model: "test/model", run_in_background: true,
                    })
                    if (nested.kind !== "started") throw new Error(JSON.stringify(nested))
                    await owner.manager.waitFor(nested.task_id)
                  } else await session.executeTool("computer", capture)
                  finalText = "done"
                },
                steer: (text) => session.steer(text),
                followUp: (text) => session.followUp(text),
                abort: () => session.abort(),
                subscribe: (listener) => session.subscribe(listener),
                getLastAssistantText: () => finalText,
                dispose: () => session.dispose(),
              }
            },
          }), () => ({ agentDir: join(cwd, "agent") })),
          process: () => createRpcManagedRunner(new RpcProcessRunner({
            modelAdmission: async () => {},
            spawnProcess(command, args, options) {
              const child = spawn(command, [...args], options)
              exits.push(new Promise<void>((resolve) => child.once("close", () => resolve())))
              return child
            },
            buildSpawn: (spec) => ({
              command: process.execPath,
              args: [join(import.meta.dir, "permission-child.test-fixture.ts"), spec.root_session_id ?? "", String(spec.depth ?? 1)],
              cwd,
              env: { HOME: cwd, PATH: process.env.PATH ?? "" },
            }),
          })),
        },
      })
    },
  }
  const fixture = await permissionSession({ sessionContext, components: [owner] })
  const taskEngine = engine
  if (taskEngine === undefined) throw new Error("Task engine did not register")
  taskEngine.runtime.captureFrom({ cwd: fixture.home, modelRegistry: createTeamServiceTestModelRegistry(["test/model"]), sessionManager: fixture.session.sessionManager })
  return {
    ...fixture,
    engine: taskEngine,
    async child(mode: "process" | "in-process", prompt = "capture") {
      const sessionId = fixture.session.sessionManager.getSessionId()
      const ancestry = taskEngine.ancestry
      const started = await taskEngine.manager.start({
        prompt, parent_session_id: sessionId,
        root_session_id: ancestry?.rootSessionId ?? sessionId,
        depth: (ancestry?.depth ?? 0) + 1,
        execution_mode: mode, model: "test/model", run_in_background: true,
      })
      if (started.kind !== "started") throw new Error(JSON.stringify(started))
      const settled = await taskEngine.manager.waitFor(started.task_id)
      if (settled.status !== "completed") throw new Error(JSON.stringify(settled))
    },
    async close() {
      for (const id of taskEngine.manager.residentTaskIds()) {
        const handle = taskEngine.manager.getResidentHandle(id)
        await handle?.abort()
      }
      await Promise.all(exits)
      for (const id of taskEngine.manager.residentTaskIds()) {
        const handle = taskEngine.manager.getResidentHandle(id)
        await handle?.dispose()
        taskEngine.manager.forget(id)
      }
      await fixture.close()
    },
  }
}
