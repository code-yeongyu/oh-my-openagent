/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  AST_GREP_REPLACE_DESCRIPTION,
  AST_GREP_SEARCH_DESCRIPTION,
  AST_GREP_SEARCH_PATTERN_PARAM,
} from "./tool-descriptions"

describe("AST_GREP_SEARCH_DESCRIPTION", () => {
  it("#given the description #when inspecting #then asserts it is NOT regex", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("NOT regex")
  })

  it("#given the description #when inspecting #then explains meta-variables $VAR and $$$", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("$VAR")
    expect(description).toContain("$$$")
  })

  it("#given the description #when inspecting #then warns against regex alternation", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("alternation")
    expect(description).toContain("|")
  })

  it("#given the description #when inspecting #then warns against regex wildcards", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain(".*")
    expect(description).toContain("wildcards")
  })

  it("#given the description #when inspecting #then warns against regex escapes", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("\\w")
  })

  it("#given the description #when inspecting #then warns against character classes", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("[a-z]")
  })

  it("#given the description #when inspecting #then tells LLM to use grep as fallback", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description.toLowerCase()).toContain("grep")
  })

  it("#given the description #when showing Python example #then omits the trailing colon bug", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).not.toContain("def $FUNC($$$):")
    expect(description).toContain("def $FUNC($$$)")
  })

  it("#given the description #when inspecting #then shows TypeScript example", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("typescript")
    expect(description).toContain("function $NAME($$$) { $$$ }")
  })

  it("#given the description #when inspecting #then shows Go example", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("go")
    expect(description).toContain("func $NAME($$$) { $$$ }")
  })

  it("#given the description #when inspecting #then shows Rust example", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description).toContain("rust")
    expect(description).toContain("fn $NAME(")
  })

  it("#given the description #when measuring #then stays within a token-reasonable length", () => {
    // given / when
    const description = AST_GREP_SEARCH_DESCRIPTION

    // then
    expect(description.length).toBeLessThan(2000)
    expect(description.length).toBeGreaterThan(400)
  })
})

describe("AST_GREP_SEARCH_PATTERN_PARAM", () => {
  it("#given the param description #when inspecting #then states meta-var rules", () => {
    // given / when
    const description = AST_GREP_SEARCH_PATTERN_PARAM

    // then
    expect(description).toContain("$VAR")
    expect(description).toContain("$$$")
  })

  it("#given the param description #when inspecting #then forbids regex syntax", () => {
    // given / when
    const description = AST_GREP_SEARCH_PATTERN_PARAM

    // then
    expect(description).toContain("NOT regex")
    expect(description).toContain("|")
    expect(description).toContain(".*")
  })

  it("#given the param description #when inspecting #then directs to grep for fallback", () => {
    // given / when
    const description = AST_GREP_SEARCH_PATTERN_PARAM

    // then
    expect(description.toLowerCase()).toContain("grep")
  })
})

describe("AST_GREP_REPLACE_DESCRIPTION", () => {
  it("#given the description #when inspecting #then mentions AST meta-variables", () => {
    // given / when
    const description = AST_GREP_REPLACE_DESCRIPTION

    // then
    expect(description).toContain("$VAR")
    expect(description).toContain("$$$")
  })

  it("#given the description #when inspecting #then warns against regex", () => {
    // given / when
    const description = AST_GREP_REPLACE_DESCRIPTION

    // then
    expect(description.toLowerCase()).toContain("regex does not work")
  })

  it("#given the description #when inspecting #then provides an example", () => {
    // given / when
    const description = AST_GREP_REPLACE_DESCRIPTION

    // then
    expect(description).toContain("console.log($MSG)")
    expect(description).toContain("logger.info($MSG)")
  })
})
