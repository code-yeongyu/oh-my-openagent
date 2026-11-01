import { expect, test } from "bun:test"
import { stepFor } from "./task-host-e2e-shards-rollback-live.mjs"

test("#given prior child prompt in resumed parent history #when routed #then parent reads its task", () => {
  const step = stepFor({ messages: [
    { role: "user", content: "rollback parent proj" },
    { role: "assistant", content: "rollback proj child" },
    { role: "user", content: "resume-parent task=st_1234abcd" },
  ] }, { resumePhase: true })
  expect(step).toMatchObject({ type: "tool_call", name: "task_output", arguments: { task_id: "st_1234abcd" } })
})

test("#given completed task_output in resumed parent history #when routed #then parent stays held", () => {
  const state = { resumePhase: true, resumeRelease: false }
  const step = stepFor({ messages: [
    { role: "user", content: "resume-parent task=st_1234abcd" },
    { role: "assistant", content: { name: "task_output", child: "rollback proj child" } },
  ] }, state)
  expect(step.type).toBe("text")
  expect(step.releaseWhen()).toBe(false)
  state.resumeRelease = true
  expect(step.releaseWhen()).toBe(true)
})
