import { expect, test } from "bun:test"
import { displayText, safeName } from "./prompt"

test("custom names reject terminal control sequences while existing labels render literally", () => {
  const name = "\u001b[2Jinjected\u009b31m\nnext"
  expect(safeName(name)).toContain("terminal control")
  expect(displayText(name)).toBe("\\u001b[2Jinjected\\u009b31m\\u000anext")
  expect(displayText("正常/custom-category")).toBe("正常/custom-category")
  expect(safeName("__back__")).toBeUndefined()
  expect(safeName("__proto__")).toContain("reserved")
})
