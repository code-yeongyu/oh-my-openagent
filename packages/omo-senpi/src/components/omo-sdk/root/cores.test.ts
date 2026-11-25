import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { type CoreContext, createOmoSdk } from ".."
import { assembleOmoSdk } from "../assembly"

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }
const principal = { kind: "script", uid: 501 } as const

describe("the root's launcher-side cores", () => {
  test("#given a diagnostics loader #when the root is built and then run twice #then the loader runs once, on the first call, with the root's context", async () => {
    const contexts: CoreContext[] = []
    const root = assembleOmoSdk(
      { env, cwd: "/work", principal },
      {
        cores: {
          diagnostics: async (context) => {
            contexts.push(context)
            return { run: async () => ({ kind: "ok", value: { findings: [] } }) }
          },
        },
      },
    )
    expect(contexts).toEqual([])
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "ok" })
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "ok" })
    expect(contexts).toEqual([{ env, cwd: "/work", principal }])
  })

  test("#given two distinct calls of one namespace made at once on first use #when both answer #then the namespace's core loaded once", async () => {
    let loads = 0
    const root = assembleOmoSdk(
      { env, cwd: tmpdir() },
      {
        cores: {
          diagnostics: async () => {
            loads += 1
            return {
              run: async () => ({ kind: "ok", value: { findings: [] } }),
              models: async () => ({
                kind: "ok",
                value: {
                  excludeModels: [],
                  categories: [],
                  agents: [],
                  modelProfile: { profile: "default", selection: "default", rungs: [] },
                },
              }),
            }
          },
        },
      },
    )
    const answers = await Promise.all([root.diagnostics.run({}), root.diagnostics.models({})])
    expect(answers.map((answer) => answer.kind)).toEqual(["ok", "ok"])
    expect(loads).toBe(1)
  })

  test("#given a loader that rejects once #when the namespace is called twice #then the first call answers internal_error as data and the second loads again and answers", async () => {
    let loads = 0
    const root = assembleOmoSdk(
      { env, cwd: tmpdir() },
      {
        cores: {
          diagnostics: async () => {
            loads += 1
            if (loads === 1) throw new Error("loader-secret-detail")
            return { run: async () => ({ kind: "ok", value: { findings: [] } }) }
          },
        },
      },
    )
    const first = await root.diagnostics.run({})
    expect(first).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(JSON.stringify(first)).not.toContain("loader-secret-detail")
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "ok" })
    expect(loads).toBe(2)
  })

  test("#given a loader that leaves a call out, and no loader for install #when those calls run #then each answers not_implemented", async () => {
    const root = assembleOmoSdk({ env, cwd: tmpdir() }, { cores: { diagnostics: async () => ({}) } })
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
    expect(await root.install.version()).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
  })

  test("#given a loader for a namespace this package serves itself #when the root is built #then construction refuses it by name", () => {
    const build = () =>
      assembleOmoSdk(
        { env, cwd: tmpdir() },
        // @ts-expect-error a loader only adds a launcher-side namespace; threads is the SDK's own core
        { cores: { threads: async () => ({}) } },
      )
    expect(build).toThrow(
      new TypeError("createOmoSdk: cores may only add diagnostics, install; threads is served by the SDK itself"),
    )
  })
})

// Public API contract (design 4.1): the cores are the shipping entry's; the public options never carry them.
describe("the public SDK entry", () => {
  test("#given a caller that passes cores to createOmoSdk #when the root is built #then the type rejects it and construction refuses it", () => {
    const build = () =>
      createOmoSdk({
        env,
        cwd: tmpdir(),
        // @ts-expect-error cores is not a public option
        cores: { diagnostics: async () => ({}) },
      })
    expect(build).toThrow(
      new TypeError("createOmoSdk: cores is set by the entry that ships the launcher library, not by a caller"),
    )
  })

  test("#given the entry a session's provisioned SDK root is built from #when its exports are read #then it offers createOmoSdk and no assembly function", async () => {
    const entry = await import("../../../extension/omo-sdk")
    expect(Object.keys(entry).toSorted()).toEqual(["SDK_VERSION", "createOmoSdk"])
  })
})
