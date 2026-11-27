import { describe, expect, test } from "bun:test"
import { makeRecord } from "../tools/output/__fixtures__/records"
import { resolveTaskTarget } from "./task-target"

describe("worker nickname targets", () => {
  test.each(["Io XXII", "Io #22", "Io the Twenty-Second", "Io the 22nd"])(
    "#given stored nickname %s #when a coordinator uses a different occurrence style #then the task still resolves",
    (nickname) => {
      const record = makeRecord({ nickname, parent_session_id: "owner" })
      for (const alias of ["Io XXII", "Io #22", "Io the Twenty-Second", "Io the 22nd"])
        expect(resolveTaskTarget([record], alias, "owner")?.task_id).toBe(record.task_id)
      expect(resolveTaskTarget([record], "Io the 22th", "owner")).toBeUndefined()
      expect(resolveTaskTarget([record], "Io IIX", "owner")).toBeUndefined()
    },
  )

  test("#given collisions #when resolving a target #then canonical keys and exact labels win, but ambiguous aliases refuse", () => {
    const numbered = makeRecord({ task_id: "st_00000001", nickname: "Io III", parent_session_id: "owner" })
    const written = makeRecord({ task_id: "st_00000002", nickname: "Io the Third", parent_session_id: "owner" })
    const foreign = makeRecord({ task_id: "st_00000003", nickname: "Io #3", parent_session_id: "foreign" })
    const canon = makeRecord({ task_id: "st_00000004", name: "Io III", parent_session_id: "owner" })
    expect(resolveTaskTarget([numbered, canon], "Io III", "owner")?.task_id).toBe(canon.task_id)
    expect(resolveTaskTarget([numbered, foreign], "Io #3", "owner")?.task_id).toBe(numbered.task_id)
    expect(resolveTaskTarget([numbered, written], "Io the Third", "owner")?.task_id).toBe(written.task_id)
    expect(resolveTaskTarget([numbered, written, foreign], "Io #3", "owner")).toBeUndefined()
    expect(resolveTaskTarget([numbered], "Io III")).toBeUndefined()
  })
})
