/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"
import { AST_GREP_REPLACE_DESCRIPTION, AST_GREP_SEARCH_DESCRIPTION } from "./tool-descriptions"

const runSgMock = mock(async () => ({
  matches: [],
  totalMatches: 0,
  truncated: false,
}))

mock.module("./cli", () => ({
  runSg: runSgMock,
}))

import { createAstGrepTools } from "./tools"

describe("createAstGrepTools", () => {
  beforeEach(() => {
    runSgMock.mockClear()
  })

  it("#given the production tool factory #when creating tools #then exposes shared ast-grep descriptions", () => {
    // given / when
    const tools = createAstGrepTools({ directory: "/repo" } as never)

    // then
    expect(tools.ast_grep_search.description).toBe(AST_GREP_SEARCH_DESCRIPTION)
    expect(tools.ast_grep_replace.description).toBe(AST_GREP_REPLACE_DESCRIPTION)
    expect(tools.ast_grep_search.description).toContain("NOT regex")
  })

  it("#given empty search results from a regex-shaped pattern #when executing #then appends the pattern hint", async () => {
    // given
    const tools = createAstGrepTools({ directory: "/repo" } as never)

    // when
    const output = await tools.ast_grep_search.execute(
      { pattern: "foo|bar", lang: "typescript" },
      {},
    )

    // then
    expect(output).toContain("No matches found")
    expect(output).toContain("alternation")
    expect(output).toContain("grep")
    expect(runSgMock).toHaveBeenCalledWith({
      pattern: "foo|bar",
      lang: "typescript",
      paths: ["/repo"],
      globs: undefined,
      context: undefined,
    })
  })
})
