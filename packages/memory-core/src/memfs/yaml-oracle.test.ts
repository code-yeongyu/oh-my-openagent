import { expect, test } from "bun:test"
import { parseYaml } from "./yaml.test-support"

test.each([
  ["0o20", 16],
  [".NaN", Number.NaN],
])("#given YAML core scalar %s #when the oracle parses it #then its value is %s", (scalar, value) => {
  // given
  const header = `description: ${scalar}`

  // when
  const parsed = parseYaml(header)

  // then
  expect(parsed).toEqual({ description: value })
})
