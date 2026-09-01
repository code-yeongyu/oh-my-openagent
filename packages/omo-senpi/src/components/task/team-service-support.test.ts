import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { resolveTeamRuntimeDirs } from "@oh-my-opencode/senpi-task"

import { makeShutdownMessenger } from "./team-service-support"

afterEach(cleanupProjects)

describe("makeShutdownMessenger", () => {
  test("#given a mapped running member #when a shutdown notice is sent #then the notice steers into the running turn", async () => {
    const { manager, inProcess, project } = makeManager()
    const started = await manager.start(baseSpec({ name: "beta" }))
    if (started.kind !== "started") throw new Error("expected started")
    const runtimeDir = resolveTeamRuntimeDirs({ project_dir: project }, "run-1").runtimeDir
    mkdirSync(runtimeDir, { recursive: true })
    writeFileSync(join(runtimeDir, "senpi-task-members.json"), `${JSON.stringify({ beta: started.task_id })}\n`)

    const messenger = makeShutdownMessenger(manager, { project_dir: project }, "run-1")
    await messenger({ to: "beta", kind: "shutdown_request", body: "finish current work" })

    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected member handle")
    expect(handle.steerCalls).toEqual(["[team shutdown_request] finish current work"])
    expect(handle.followUpCalls).toEqual([])
  })
})
