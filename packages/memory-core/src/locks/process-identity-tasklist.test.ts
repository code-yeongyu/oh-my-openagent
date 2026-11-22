// Platform contract: on Windows a lock holder is named by the image name tasklist reports (#14117). A row for another
// pid, an INFO line or an empty answer must never name a holder.
import { describe, expect, test } from "bun:test"
import { tasklistImageName } from "./process-identity"

describe("tasklistImageName", () => {
  test.each([
    ["a matching row", `"bun.exe","1234","Console","1","12,345 K"`, "bun.exe"],
    ["an image name with spaces", `"Code Helper.exe","1234","Console","1","8,000 K"`, "Code Helper.exe"],
    [
      "the INFO line tasklist prints when nothing matches",
      "INFO: No tasks are running which match the specified criteria.",
      null,
    ],
    ["a row for another pid sharing the prefix", `"bun.exe","12345","Console","1","12,345 K"`, null],
    [
      "a first row for another pid ahead of the right one",
      `"bun.exe","99","Console","1","1 K"\n"node.exe","1234","Console","1","2 K"`,
      null,
    ],
    ["no output", null, null],
  ])("#given %s #then it answers the image name only for the asked pid", (_case, output, expected) => {
    expect(tasklistImageName(output, 1234)).toBe(expected)
  })
})
