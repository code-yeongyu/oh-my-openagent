import { describe, expect, test } from "bun:test"

import { failureReason } from "./runner-results"

describe("failureReason", () => {
  test("#given a failed finalize whose detail names secret-like content #when mapped #then the reason is secret_like_content", () => {
    // given
    const result = {
      status: "failed" as const,
      detail: "secret_like_content: reference/y.md (pem_block) @abc1234",
      cleanup: { worktreeRemoved: true, branchRemoved: true },
    }

    // when
    const mapped = failureReason(result)

    // then
    expect(mapped.reason).toBe("secret_like_content")
  })

  test("#given a failed finalize with a validation detail #when mapped #then the reason stays completion_validation", () => {
    const mapped = failureReason({
      status: "failed",
      detail: "Git administration files were modified",
      cleanup: { worktreeRemoved: true, branchRemoved: true },
    })
    expect(mapped.reason).toBe("completion_validation")
  })
})
