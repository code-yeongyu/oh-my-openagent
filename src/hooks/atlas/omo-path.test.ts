import { describe, expect, test } from "bun:test"
import { isOmoPath } from "./omo-path"

describe("isOmoPath", () => {
  test("#given a path under an omo directory #when checking the path #then it matches the omo segment", () => {
    expect(isOmoPath(".omo/plans/work.md")).toBe(true)
    expect(isOmoPath("/repo/.omo/plans/work.md")).toBe(true)
    expect(isOmoPath(String.raw`C:\repo\.omo\plans\work.md`)).toBe(true)
  })

  test("#given a path whose directory merely ends with omo #when checking the path #then it does not match", () => {
    expect(isOmoPath("/repo/work.omo/plans/work.md")).toBe(false)
    expect(isOmoPath("/repo/.omo-backup/plans/work.md")).toBe(false)
    expect(isOmoPath("/repo/notes.omo")).toBe(false)
  })
})
