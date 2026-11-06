import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { createTaskComponent } from "./index"
import type { JobWidgetAuthorResolver, JobWidgetHostApi } from "./job-widget-host"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-job-widgets-"))
  tempRoots.push(dir)
  return dir
}

function logger(): ComponentLogger & { warnings: string[] } {
  const warnings: string[] = []
  return { warnings, info: () => {}, warn: (message) => { warnings.push(message) }, error: () => {} }
}

function ctxFor(pi: FakeExtensionAPI, log: ComponentLogger): ComponentContext {
  return { logger: log, config: { getFlag: (name) => pi.getFlag(name) }, getCapturedTools: () => [] }
}

const quickModel = { provider: "omo-mock", id: "mock-quick" }
const sessionModel = { provider: "omo-mock", id: "mock-session" }
const models = [sessionModel, quickModel]
const modelRegistry = {
  getAvailable: () => models,
  find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
}

describe("task component job widget wiring", () => {
  it("#given a senpi with the job widget API #when the task component registers #then the author route answers the project's quick model until session shutdown", async () => {
    // given
    const project = tempProject()
    const pi = new FakeExtensionAPI()
    let route: JobWidgetAuthorResolver | undefined
    const host: JobWidgetHostApi = {
      setAuthorResolver: (resolver) => {
        route = resolver
        return () => { if (route === resolver) route = undefined }
      },
      sources: { register: () => undefined, createTap: () => ({ id: "tools", label: "", append: () => {}, close: () => {}, read: (from) => ({ start: from, end: from, text: "", open: true }) }) },
    }

    // when
    await createTaskComponent({
      resolveCwd: () => project,
      loadConfig: (args) => {
        const loaded = loadSenpiOmoConfig(args)
        return { ...loaded, config: { ...loaded.config, categories: { quick: { model: "omo-mock/mock-quick" } } } }
      },
      loadJobWidgetHost: async () => host,
    }).register(pi, ctxFor(pi, logger()))

    // then
    expect(route?.({ cwd: project, modelRegistry })).toBe(quickModel)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, {})
    expect(route).toBeUndefined()
  })

  it("#given the senpi module cannot be read #when the task component registers #then it warns once and the task tools still register", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const log = logger()

    // when
    await createTaskComponent({
      resolveCwd: () => tempProject(),
      loadJobWidgetHost: async () => { throw new Error("module not found") },
    }).register(pi, ctxFor(pi, log))

    // then
    expect(log.warnings.filter((message) => message.includes("job widgets unavailable"))).toHaveLength(1)
    expect(pi.tools.map((tool) => tool["name"])).toContain("task")
  })
})
