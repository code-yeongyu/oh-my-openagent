import { expect, test } from "bun:test"
import { Check } from "typebox/value"
import { MemberTaskSendParams } from "./tools"

test("#given member task_send parameters #when validated by the runtime #then required fields and optional summary retain their contract", () => {
  expect(Check(MemberTaskSendParams, { to: "lead", message: "hello" })).toBe(true)
  expect(Check(MemberTaskSendParams, { to: "alice", message: "hello", summary: "note" })).toBe(true)
  expect(Check(MemberTaskSendParams, { to: "lead", message: "hello", extra: true })).toBe(true)
  for (const input of [null, {}, { to: "lead" }, { message: "hello" }, { to: 1, message: "hello" },
    { to: "lead", message: false }, { to: "lead", message: "hello", summary: 1 }]) {
    expect(Check(MemberTaskSendParams, input)).toBe(false)
  }
})
