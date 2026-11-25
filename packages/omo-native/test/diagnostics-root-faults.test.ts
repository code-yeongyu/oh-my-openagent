import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { assembleOmoSdk } from "../../omo-senpi/src/components/omo-sdk/assembly"
import { createDiagnosticsLoader } from "../diagnostics-loader"

describe("diagnostics through the root when a dependency fails", () => {
  test("#given a process listing that throws #when reapStaleEngines is called through the root #then it resolves internal_error carrying only the error's name", async () => {
    const loader = createDiagnosticsLoader({
      list: () => {
        throw new TypeError("ps failed reading /secret/canary7a1c")
      },
    })
    const root = assembleOmoSdk({ env: {}, cwd: tmpdir() }, { cores: { diagnostics: loader } })
    const answer = await root.diagnostics.reapStaleEngines({ pids: [4242] })
    expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error", details: { name: "TypeError" } } })
    expect(JSON.stringify(answer)).not.toContain("canary7a1c")
  })

  test("#given a model runtime that throws a non-error #when models is called through the root #then it resolves to data, never rejects", async () => {
    const loader = createDiagnosticsLoader({
      loadRuntime: () => {
        throw "not an error object"
      },
    })
    const root = assembleOmoSdk({ env: {}, cwd: tmpdir() }, { cores: { diagnostics: loader } })
    expect(await root.diagnostics.models({})).toMatchObject({ kind: "error", error: { code: "internal_error" } })
  })
})
