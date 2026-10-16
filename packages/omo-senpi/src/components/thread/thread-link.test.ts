import { expect, test } from "bun:test"

import { parseThreadLinkUrl, threadLink, threadLinkUrl } from "./thread-link"

test("#given a thread id #when its link is built and parsed #then the same id comes back", () => {
  for (const id of ["019a0000-0000-7000-8000-00000000000a", "dur peer/1?x#y"]) {
    expect(parseThreadLinkUrl(threadLinkUrl(id))).toEqual({ threadId: id })
  }
})

test("#given a title with markdown brackets or no title #when the markdown link is built #then the label is escaped or falls back, and the target is the v1 link", () => {
  expect(threadLink("t1", "fix [gateway] lock")).toBe("[fix \\[gateway\\] lock](omo-thread://v1/t1)")
  expect(threadLink("t1", "   ")).toBe("[thread](omo-thread://v1/t1)")
  expect(threadLink("t1", null)).toBe("[thread](omo-thread://v1/t1)")
})

test("#given a session name shaped like an autolink or raw HTML #when the markdown link is built #then the angle brackets are escaped so no second link can render inside the thread link", () => {
  expect(threadLink("t1", "<https://evil.example>")).toBe("[\\<https://evil.example\\>](omo-thread://v1/t1)")
  expect(threadLink("t1", "see <a href=\"https://evil.example\">here</a>")).toBe("[see \\<a href=\"https://evil.example\"\\>here\\</a\\>](omo-thread://v1/t1)")
})

test("#given a session name with an entity or a backtick #when the markdown link is built #then & and ` are escaped so the label displays as typed and cannot open a code span", () => {
  expect(threadLink("t1", "&#x5D;(https://evil.example)")).toBe("[\\&#x5D;(https://evil.example)](omo-thread://v1/t1)")
  expect(threadLink("t1", "a ` b")).toBe("[a \\` b](omo-thread://v1/t1)")
})

test("#given anything that is not a v1 thread link #when parsed #then it is null", () => {
  for (const url of ["https://example.com", "omo-thread://v2/t1", "omo-thread://v1/", "omo-thread://v1/a/b", "omo-thread://v1/%E0%A4%A", "omo-thread://v1/a?x", "omo-thread://v1/a#frag"]) {
    expect(parseThreadLinkUrl(url)).toBeNull()
  }
})
