import { describe, expect, mock, test } from "bun:test"

import {
  callWithSessionPathCompatibility,
  isObjectPathTypeError,
} from "./session-path-compat"

describe("session path compatibility", () => {
  test("#given an object-path type error #when retried #then it uses a string session path", async () => {
    // given
    const calls: Array<{ path: { id: string } | string }> = []
    const operation = mock(async (input: { path: { id: string } | string }) => {
      calls.push(input)
      if (typeof input.path !== "string") {
        throw new TypeError('The "path" property must be of type string, got object')
      }
      return { ok: true }
    })

    // when
    const result = await callWithSessionPathCompatibility(operation, {
      path: { id: "ses_task_path_compat" },
    })

    // then
    expect(result).toEqual({ ok: true })
    expect(calls.map((call) => call.path)).toEqual([
      { id: "ses_task_path_compat" },
      "ses_task_path_compat",
    ])
  })

  test("#given a non-path error #when compatibility runs #then it rethrows unchanged", async () => {
    // given
    const operation = mock(async () => {
      throw new Error("unrelated failure")
    })

    // when / then
    await expect(callWithSessionPathCompatibility(operation, {
      path: { id: "ses_task_path_compat" },
    })).rejects.toThrow("unrelated failure")
  })

  test("#given the known SDK path error message #when classified #then it is recognized", () => {
    expect(isObjectPathTypeError(new TypeError('The "path" property must be of type string, got object'))).toBe(true)
  })
})
