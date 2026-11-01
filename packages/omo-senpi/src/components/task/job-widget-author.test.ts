import { describe, expect, it } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { installJobWidgetAuthor, resolveJobWidgetAuthorModel } from "./job-widget-author"
import type { JobWidgetAuthorContext, JobWidgetAuthorResolver, JobWidgetHostApi } from "./job-widget-host"

const quickModel = { provider: "omo-mock", id: "mock-quick" }
const sessionModel = { provider: "omo-mock", id: "mock-session" }

function registry(models: readonly { provider: string; id: string }[]): JobWidgetAuthorContext["modelRegistry"] {
  return {
    getAvailable: () => models,
    find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
  }
}

const quickConfig: OmoConfig = { categories: { quick: { model: "omo-mock/mock-quick" } } }

function fakeHost(): JobWidgetHostApi & { current(): JobWidgetAuthorResolver | undefined; installs: number } {
  let current: JobWidgetAuthorResolver | undefined
  const host = {
    installs: 0,
    current: () => current,
    setAuthorResolver: (resolver: JobWidgetAuthorResolver | undefined) => {
      host.installs += 1
      current = resolver
      return () => {
        if (current === resolver) current = undefined
      }
    },
  }
  return host
}

describe("job widget author on the quick category", () => {
  it("#given omo.json pins quick #when the author model resolves #then it is the registry's quick model, not the session model", () => {
    // when
    const model = resolveJobWidgetAuthorModel(quickConfig, registry([sessionModel, quickModel]))

    // then
    expect(model).toBe(quickModel)
  })

  it("#given quick's model is not in the registry #when the author model resolves #then it is undefined so senpi falls back to the session model", () => {
    // when
    const model = resolveJobWidgetAuthorModel(quickConfig, registry([sessionModel]))

    // then
    expect(model).toBeUndefined()
  })

  it("#given a senpi with setJobWidgetAuthorResolver #when a session installs the author #then senpi's route answers that session's cwd with the quick model", () => {
    // given
    const host = fakeHost()

    // when
    const release = installJobWidgetAuthor(host, "/project-a", quickConfig)

    // then
    const route = host.current()
    expect(route).toBeDefined()
    expect(route?.({ cwd: "/project-a", modelRegistry: registry([sessionModel, quickModel]) })).toBe(quickModel)
    expect(route?.({ cwd: "/elsewhere", modelRegistry: registry([sessionModel, quickModel]) })).toBeUndefined()
    release()
    expect(host.current()).toBeUndefined()
  })

  it("#given two sessions in one process #when the first releases #then the route stays for the second and is withdrawn only after the last release", () => {
    // given
    const host = fakeHost()
    const otherConfig: OmoConfig = { categories: { quick: { model: "omo-mock/mock-session" } } }
    const releaseA = installJobWidgetAuthor(host, "/project-a", quickConfig)
    const releaseB = installJobWidgetAuthor(host, "/project-b", otherConfig)

    // when
    releaseA()
    releaseA()

    // then
    expect(host.installs).toBe(1)
    const models = registry([sessionModel, quickModel])
    expect(host.current()?.({ cwd: "/project-b", modelRegistry: models })).toBe(sessionModel)
    expect(host.current()?.({ cwd: "/project-a", modelRegistry: models })).toBeUndefined()
    releaseB()
    expect(host.current()).toBeUndefined()
  })

  it("#given a host whose session never shut down #when a session installs on a second host #then the second host gets its own route", () => {
    // given
    const leaked = fakeHost()
    installJobWidgetAuthor(leaked, "/project-a", quickConfig)
    const host = fakeHost()

    // when
    const release = installJobWidgetAuthor(host, "/project-b", quickConfig)

    // then
    expect(host.installs).toBe(1)
    expect(host.current()?.({ cwd: "/project-b", modelRegistry: registry([sessionModel, quickModel]) })).toBe(quickModel)
    expect(host.current()?.({ cwd: "/project-a", modelRegistry: registry([sessionModel, quickModel]) })).toBeUndefined()
    release()
    expect(host.current()).toBeUndefined()
    expect(leaked.current()).toBeDefined()
  })
})
