import { describe, expect, test } from "bun:test"
import { getMissingLookAtFilePath } from "./missing-file-error"

describe("getMissingLookAtFilePath", () => {
  test("#given ENOENT error with path property #when formatting look_at error #then returns missing path", () => {
    //#given
    const error = new Error("ENOENT: no such file or directory")
    Object.defineProperty(error, "code", { value: "ENOENT" })
    Object.defineProperty(error, "path", { value: "/tmp/missing.png" })

    //#when
    const path = getMissingLookAtFilePath(error, { file_path: "/tmp/fallback.png", goal: "inspect" })

    //#then
    expect(path).toBe("/tmp/missing.png")
  })

  test("#given ENOENT message without path property #when formatting look_at error #then extracts open path", () => {
    //#given
    const error = new Error("ENOENT: no such file or directory, open '/tmp/from-message.png'")

    //#when
    const path = getMissingLookAtFilePath(error, { file_path: "/tmp/fallback.png", goal: "inspect" })

    //#then
    expect(path).toBe("/tmp/from-message.png")
  })
})
