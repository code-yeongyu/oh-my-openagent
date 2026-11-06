import { describe, expect, test } from "bun:test"

import {
  GITHUB_ISSUE_URL_MAX,
  githubIssueUrl,
  readSupportQuery,
  sliceAtCodePoint,
  SUPPORT_BODY_MAX,
  SUPPORT_TITLE_MAX,
} from "./support-report"

describe("readSupportQuery", () => {
  test("#given the desktop report query #when read #then title and body come back trimmed", () => {
    expect(
      readSupportQuery({ title: "  Anthropic sign-in missing  ", body: "Steps\n1. open" }),
    ).toEqual({
      title: "Anthropic sign-in missing",
      body: "Steps\n1. open",
    })
  })

  test("#given no query #when read #then both are empty", () => {
    expect(readSupportQuery({})).toEqual({ title: "", body: "" })
  })

  test("#given a repeated parameter #when read #then the first value is used", () => {
    expect(readSupportQuery({ title: ["first", "second"] }).title).toBe("first")
  })

  test("#given an oversized title and body #when read #then both are capped", () => {
    const query = readSupportQuery({
      title: "t".repeat(SUPPORT_TITLE_MAX + 50),
      body: "b".repeat(SUPPORT_BODY_MAX + 50),
    })
    expect(query.title).toHaveLength(SUPPORT_TITLE_MAX)
    expect(query.body).toHaveLength(SUPPORT_BODY_MAX)
  })
})

describe("githubIssueUrl", () => {
  test("#given a report #when the issue link is built #then it opens a new issue on the public repo with the report prefilled", () => {
    const url = new URL(githubIssueUrl({ title: "Report a problem 404", body: "a & b = c" }))
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/code-yeongyu/oh-my-openagent/issues/new",
    )
    expect(url.searchParams.get("title")).toBe("Report a problem 404")
    expect(url.searchParams.get("body")).toBe("a & b = c")
  })

  test("#given a body too long for a URL #when the issue link is built #then the body is shortened and marked, never the title", () => {
    const href = githubIssueUrl({ title: "Long report", body: "x".repeat(20_000) })
    const url = new URL(href)
    expect(href.length).toBeLessThanOrEqual(GITHUB_ISSUE_URL_MAX)
    expect(url.searchParams.get("title")).toBe("Long report")
    expect(url.searchParams.get("body")?.endsWith("…")).toBe(true)
  })

  test("#given an empty report #when the issue link is built #then it opens a blank new issue", () => {
    const url = new URL(githubIssueUrl({ title: "", body: "" }))
    expect(url.searchParams.has("title")).toBe(false)
    expect(url.searchParams.has("body")).toBe(false)
  })
})

describe("sliceAtCodePoint", () => {
  test("#given a cut that would split an emoji #when sliced #then the emoji is dropped whole, never left as half a pair", () => {
    const text = `ab${"😀"}cd`
    expect(sliceAtCodePoint(text, 3)).toBe("ab")
    expect(sliceAtCodePoint(text, 4)).toBe("ab😀")
  })

  test("#given an emoji-heavy title over the cap #when read #then the capped title has no lone surrogate", () => {
    const title = readSupportQuery({ title: "😀".repeat(SUPPORT_TITLE_MAX) }).title
    expect(title).not.toMatch(/[\uD800-\uDBFF]$/)
    expect(title.length).toBeLessThanOrEqual(SUPPORT_TITLE_MAX)
  })
})
