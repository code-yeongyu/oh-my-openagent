import { describe, expect, test } from "bun:test"

import { fakeKernelTools } from "../runners/in-process/__fixtures__/kernel-tools-fakes"
import { resolvePoolKernelTools } from "./worker-kernel-tools"
import { WorkpoolError, type WorkpoolSpec } from "./types"

function spec(policy: { readonly toolAllowlist?: readonly string[]; readonly toolDenylist?: readonly string[] }): WorkpoolSpec {
  return {
    start: { prompt: "worker", parent_session_id: "parent", depth: 1, execution_mode: "in-process" },
    plan: { model: "fixture/fixture", ...policy },
  }
}

describe("workpool kernel-tool resolve", () => {
  test("#given a worker denylist that removes a parent write tool #when existingToolNames carries that tool #then the grant is refused", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    const denied = await resolvePoolKernelTools({
      names: ["lookup"],
      capability,
      spec: spec({ toolDenylist: ["synthetic_write"] }),
      existingToolNames: ["synthetic_write"],
    }).catch((error: unknown) => error)

    expect(denied).toBeInstanceOf(WorkpoolError)
    expect((denied as WorkpoolError).code).toBe("tools_unavailable")
  })
})
