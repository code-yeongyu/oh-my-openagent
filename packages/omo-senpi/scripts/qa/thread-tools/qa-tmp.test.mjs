import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

import { QA_TMP_ROOT, qaTmpRoot } from "./lib/qa-tmp.mjs"

describe("thread-tool QA tmp root", () => {
  test.each([
    ["linux", "/tmp"],
    ["darwin", "/tmp"],
    ["win32", "C:\\Users\\runner\\AppData\\Local\\Temp"],
  ])("#given platform %s #when the QA tmp root resolves #then it is %s", (platform, expected) => {
    expect(qaTmpRoot(platform, () => "C:\\Users\\runner\\AppData\\Local\\Temp")).toBe(expected)
  })

  test("#given this host #when the QA tmp root resolves #then it exists", () => {
    expect(existsSync(QA_TMP_ROOT)).toBe(true)
  })
})
