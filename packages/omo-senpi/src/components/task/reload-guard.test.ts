import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { evaluateReloadVeto, wireReloadGuard } from "./reload-guard"

describe("reload guard", () => {
  it("allows reload when only resident task children are running", () => {
    expect(evaluateReloadVeto()).toBeUndefined()
  })

  it("blocks reload for an in-flight DAG run", () => {
    expect(evaluateReloadVeto({
      liveRuns: () => [{ runId: "run-1", name: "research", status: "running" }],
    })).toEqual({
      cancel: true,
      reason: "1 DAG run(s) still in flight: research - wait for them to finish or cancel them (dag cancel) before reloading.",
    })
  })

  it("wires the DAG-only veto to session_before_reload", async () => {
    const pi = new FakeExtensionAPI()
    wireReloadGuard(pi, { liveRuns: () => [] })
    expect(await pi.dispatch("session_before_reload", {})).toEqual([undefined])
  })
})
