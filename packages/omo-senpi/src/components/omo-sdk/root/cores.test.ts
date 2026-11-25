import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { type CoreContext, createOmoSdk } from ".."

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }
const principal = { kind: "script", uid: 501 } as const

describe("the root's launcher-side cores", () => {
  test("#given a diagnostics loader #when the root is built and then run twice #then the loader runs once, on the first call, with the root's context", async () => {
    const contexts: CoreContext[] = []
    const root = createOmoSdk({
      env,
      cwd: "/work",
      principal,
      cores: {
        diagnostics: async (context) => {
          contexts.push(context)
          return { run: async () => ({ kind: "ok", value: { findings: [] } }) }
        },
      },
    })
    expect(contexts).toEqual([])
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "ok" })
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "ok" })
    expect(contexts).toEqual([{ env, cwd: "/work", principal }])
  })

  test("#given a loader that leaves a call out, and no loader for install #when those calls run #then each answers not_implemented", async () => {
    const root = createOmoSdk({ env, cwd: tmpdir(), cores: { diagnostics: async () => ({}) } })
    expect(await root.diagnostics.run({})).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
    expect(await root.install.version()).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
  })

  test("#given a loader for a namespace this package serves itself #when the root is built #then construction refuses it by name", () => {
    const build = () =>
      createOmoSdk({
        env,
        cwd: tmpdir(),
        // @ts-expect-error a loader only adds a launcher-side namespace; threads is the SDK's own core
        cores: { threads: async () => ({}) },
      })
    expect(build).toThrow(
      new TypeError("createOmoSdk: cores may only add diagnostics, install; threads is served by the SDK itself"),
    )
  })
})
